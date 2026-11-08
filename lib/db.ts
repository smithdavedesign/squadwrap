import { mkdir } from 'node:fs/promises'
import { Pool as NeonPool, neon } from '@neondatabase/serverless'
import { attachDatabasePool } from '@vercel/functions'
import { Pool } from 'pg'

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction: commits if it resolves, rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

// One statement per entry: PGlite's query() takes a single statement.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    invite_token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    member_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    answers JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, name_key)
  )`,
  `CREATE TABLE IF NOT EXISTS awards (
    submission_id INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    citation TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS awards_group_id_idx ON awards (group_id)`,
  // Yearbook reports for the operator (M3). UNIQUE (group_id, id) is there for its index, which serves the
  // per-group cap and cascading deletes; declared inline, it costs no CREATE INDEX (and no lock) at cold start.
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    contact TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, id)
  )`,
]

/** Columns added after M1, as [table, column, definition]: databases created earlier are upgraded in place. */
const ADDED_COLUMNS = [
  // NULL until the group is paid for (the Stripe webhook sets it, lib/payments.ts); until then slides carry a watermark.
  ['groups', 'unlocked_at', 'TIMESTAMPTZ'],
  // The friend's optional photo, already normalized to a small JPEG (lib/photo.ts). Deleted with the submission.
  ['submissions', 'photo', 'BYTEA'],
  // The yearbook's read-only key (M3). The app gives new groups 16 random bytes. The volatile default is evaluated
  // per row: when the column is added, each group from before M3 gets its own random token (a UUIDv4's 122 bits),
  // and so does any group inserted without one (an M2 instance still running during the rollout).
  ['groups', 'yearbook_token', `TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '')`],
] as const

// Arbitrary app-wide key for pg_advisory_xact_lock.
const MIGRATION_LOCK_KEY = 7_177_001

export async function migrate(db: Db): Promise<void> {
  await db.tx(async (q) => {
    // Cold-starting instances can run this at the same moment, and concurrent
    // CREATE … IF NOT EXISTS can still collide on catalog rows; the lock serializes them.
    await q.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY])
    for (const statement of SCHEMA) await q.query(statement)
    // ALTER TABLE takes an ACCESS EXCLUSIVE lock even with IF NOT EXISTS, so it only runs for a column that
    // is really missing; otherwise every cold start would briefly block (or deadlock with) live requests.
    const { rows } = await q.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ANY($1)`,
      [ADDED_COLUMNS.map(([table]) => table)],
    )
    const existing = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))
    for (const [table, column, definition] of ADDED_COLUMNS) {
      // Identifiers can't be parameters; these are the constants above, never input.
      if (!existing.has(`${table}.${column}`)) {
        await q.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`)
      }
    }
  })
}

type PgLike = { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }

function pgQueryable(client: PgLike): Queryable {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await client.query(text, params)
      return { rows: result.rows as T[] }
    },
  }
}

/** Production: node-postgres pool against Neon (Neon's recommended setup for Vercel Fluid compute). */
export function createPgDb(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 5 })
  attachDatabasePool(pool)
  return {
    query: pgQueryable(pool).query,
    async tx(fn) {
      return inTransaction(await pool.connect(), fn)
    },
  }
}

/** BEGIN, `fn`, then COMMIT, or ROLLBACK if it throws; the client goes back to its pool either way. */
async function inTransaction<T>(client: PgLike & { release(err?: Error): void }, fn: (q: Queryable) => Promise<T>): Promise<T> {
  // If ROLLBACK itself fails the connection is in an unknown state: destroy it instead of reusing it.
  let broken: Error | undefined
  try {
    await client.query('BEGIN')
    const result = await fn(pgQueryable(client))
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr: Error) => {
      broken = rollbackErr
    })
    throw err
  } finally {
    client.release(broken)
  }
}

/** True inside a Cloudflare Worker, which identifies itself this way (Node.js reports `Node.js/<version>`). */
export function onCloudflareWorkers(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}

/**
 * The Cloudflare Worker: Neon's serverless driver. A Worker can't reuse a socket another request opened, so nothing
 * here holds one between requests: single queries go over HTTPS (one fetch each), and each transaction opens its own
 * WebSocket connection (Neon's `Pool`, node-postgres underneath, so types and BYTEA behave as with `pg`) and closes it
 * before returning.
 */
export function createNeonDb(connectionString: string): Db {
  const sql = neon(connectionString)
  return {
    async query<T>(text: string, params?: unknown[]) {
      return { rows: (await sql.query(text, params ?? [])) as T[] }
    },
    async tx(fn) {
      const pool = new NeonPool({ connectionString, max: 1 })
      try {
        return await inTransaction(await pool.connect(), fn)
      } finally {
        await pool.end().catch(() => {})
      }
    },
  }
}

/** Tests and local dev: real Postgres compiled to WASM. In memory unless `dataDir` is given. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  // PGlite only creates the last directory level itself.
  if (dataDir) await mkdir(dataDir, { recursive: true })
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite(dataDir)
  await pg.waitReady
  return {
    query: async <T>(text: string, params?: unknown[]) => pg.query<T>(text, params),
    tx: (fn) => pg.transaction((t) => fn({ query: async <T>(text: string, params?: unknown[]) => t.query<T>(text, params) })),
  }
}

export class ConfigError extends Error {}

const globalForDb = globalThis as unknown as { squadwrapDb?: Promise<Db> }

/**
 * The app's database, created and migrated once per server instance.
 * Kept on globalThis so dev hot reloads don't open the PGlite directory twice.
 */
export function getDefaultDb(): Promise<Db> {
  globalForDb.squadwrapDb ??= openDefaultDb().catch((err) => {
    globalForDb.squadwrapDb = undefined
    throw err
  })
  return globalForDb.squadwrapDb
}

export type DbTarget = { kind: 'postgres'; url: string } | { kind: 'pglite'; dir: string }

/**
 * Where the app's data lives: Postgres at DATABASE_URL; otherwise, outside production, the local PGlite in
 * .data/pglite. PGLITE_DIR opts a local production build (`next start`, used by `npm run screenshots`) into PGlite
 * too, but never on a Vercel deployment (VERCEL is set there), where it would be a throwaway per-instance database,
 * nor on the Cloudflare Worker.
 * Production without either is a configuration error.
 */
export function defaultDbTarget(env: Record<string, string | undefined>, worker = onCloudflareWorkers()): DbTarget | null {
  if (env.DATABASE_URL) return { kind: 'postgres', url: env.DATABASE_URL }
  // A Worker has no filesystem for PGlite either.
  if (worker) return null
  const localDir = env.VERCEL ? '' : env.PGLITE_DIR?.trim()
  const dir = localDir || (env.NODE_ENV !== 'production' ? '.data/pglite' : '')
  return dir ? { kind: 'pglite', dir } : null
}

async function openDefaultDb(): Promise<Db> {
  const target = defaultDbTarget(process.env)
  if (!target) throw new ConfigError('DATABASE_URL is not set')
  const db =
    target.kind === 'pglite' ? await createPgliteDb(target.dir) : onCloudflareWorkers() ? createNeonDb(target.url) : createPgDb(target.url)
  await migrate(db)
  return db
}
