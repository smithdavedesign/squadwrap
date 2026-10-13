import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createPgliteDb, defaultDbTarget, migrate, type Db } from '../lib/db'
import { testDb } from './helpers'

let db: Db
beforeAll(async () => {
  db = await testDb()
})

const groupCount = async (id: string) =>
  (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM groups WHERE id = $1', [id])).rows[0].n

describe('db', () => {
  it('migrate is idempotent, also when two run at once', async () => {
    await expect(migrate(db)).resolves.toBeUndefined()
    await expect(Promise.all([migrate(db), migrate(db)])).resolves.toEqual([undefined, undefined])
  })

  it('tx commits when the callback succeeds', async () => {
    await db.tx(async (q) => {
      await q.query(`INSERT INTO groups (id, invite_token, name, year) VALUES ($1, $2, 'T', 2026)`, ['tx-ok', 'tx-ok-token'])
    })
    expect(await groupCount('tx-ok')).toBe(1)
  })

  it('tx rolls back everything when the callback throws', async () => {
    await expect(
      db.tx(async (q) => {
        await q.query(`INSERT INTO groups (id, invite_token, name, year) VALUES ($1, $2, 'T', 2026)`, ['tx-bad', 'tx-bad-token'])
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await groupCount('tx-bad')).toBe(0)
  })

  it('opens an on-disk PGlite database in a nested directory that does not exist yet (local dev path)', async () => {
    const root = join('.data', `test-${randomUUID()}`)
    try {
      const disk = await createPgliteDb(join(root, 'pglite'))
      await migrate(disk)
      const { rows } = await disk.query<{ n: number }>('SELECT count(*)::int AS n FROM groups')
      expect(rows[0].n).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('upgrades a database created by M1: adds the photo and unlock columns, keeping existing rows', async () => {
    const old = await createPgliteDb()
    // The M1 schema, as first deployed.
    await old.query(`CREATE TABLE groups (
      id TEXT PRIMARY KEY, invite_token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, year INTEGER NOT NULL,
      member_count INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    await old.query(`CREATE TABLE submissions (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL, name_key TEXT NOT NULL, answers JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (group_id, name_key))`)
    await old.query(`INSERT INTO groups (id, invite_token, name, year) VALUES ('m1', 'm1-token', 'Old', 2025)`)
    await old.query(`INSERT INTO submissions (group_id, display_name, name_key, answers) VALUES ('m1', 'Sam', 'sam', '{}'::jsonb)`)

    await migrate(old)
    const group = await old.query<{ unlocked_at: Date | null }>(`SELECT unlocked_at FROM groups WHERE id = 'm1'`)
    expect(group.rows).toEqual([{ unlocked_at: null }])
    const sub = await old.query<{ photo: Uint8Array | null }>(`SELECT photo FROM submissions WHERE group_id = 'm1'`)
    expect(sub.rows).toEqual([{ photo: null }])
  })

  it('gives every group created before M3 its own yearbook token, and creates the reports table', async () => {
    const old = await createPgliteDb()
    // The M1/M2 groups table, without the yearbook token.
    await old.query(`CREATE TABLE groups (
      id TEXT PRIMARY KEY, invite_token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, year INTEGER NOT NULL,
      member_count INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), unlocked_at TIMESTAMPTZ)`)
    for (const id of ['g1', 'g2', 'g3']) {
      await old.query(`INSERT INTO groups (id, invite_token, name, year) VALUES ($1, $2, 'Old', 2025)`, [id, `${id}-token`])
    }

    await migrate(old)
    const { rows } = await old.query<{ yearbook_token: string }>('SELECT yearbook_token FROM groups ORDER BY id')
    expect(rows).toHaveLength(3)
    for (const { yearbook_token } of rows) expect(yearbook_token).toMatch(/^[0-9a-f]{32}$/)
    expect(new Set(rows.map((r) => r.yearbook_token)).size).toBe(3)
    // Unique like the other keys.
    await expect(
      old.query(`INSERT INTO groups (id, invite_token, yearbook_token, name, year) VALUES ('g4', 'g4-token', $1, 'Dup', 2025)`, [
        rows[0].yearbook_token,
      ]),
    ).rejects.toMatchObject({ code: '23505' })
    const reports = await old.query<{ n: number }>('SELECT count(*)::int AS n FROM reports')
    expect(reports.rows[0].n).toBe(0)
  })

  it('indexes reports by group (the per-group cap and cascading deletes), without a separate CREATE INDEX', async () => {
    const { rows } = await db.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename = 'reports'`)
    expect(rows.some((r) => /\(group_id, id\)/.test(r.indexdef))).toBe(true)
  })

  it('deletes a group’s reports with the group', async () => {
    await db.query(`INSERT INTO groups (id, invite_token, name, year) VALUES ('rp', 'rp-token', 'T', 2026)`)
    await db.query(`INSERT INTO reports (group_id, reason) VALUES ('rp', 'Bad')`)
    await db.query(`DELETE FROM groups WHERE id = 'rp'`)
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reports WHERE group_id = 'rp'`)
    expect(rows[0].n).toBe(0)
  })

  it('runs no ALTER TABLE once the schema is current (ALTER takes an exclusive lock on hot tables at every cold start)', async () => {
    const statements: string[] = []
    const recording: Db = {
      query: db.query,
      tx: (fn) =>
        db.tx((q) =>
          fn({
            query: (text, params) => {
              statements.push(text)
              return q.query(text, params)
            },
          }),
        ),
    }
    await migrate(recording)
    expect(statements.length).toBeGreaterThan(0)
    expect(statements.filter((s) => /^\s*ALTER TABLE/i.test(s))).toEqual([])
  })

  it('picks Postgres from DATABASE_URL, local PGlite outside production or with PGLITE_DIR, and nothing otherwise', () => {
    const url = 'postgres://db.example.test/squadwrap'
    expect(defaultDbTarget({ DATABASE_URL: url, NODE_ENV: 'production', PGLITE_DIR: '.data/x' })).toEqual({ kind: 'postgres', url })
    expect(defaultDbTarget({ NODE_ENV: 'development' })).toEqual({ kind: 'pglite', dir: '.data/pglite' })
    expect(defaultDbTarget({})).toEqual({ kind: 'pglite', dir: '.data/pglite' })
    expect(defaultDbTarget({ NODE_ENV: 'production', PGLITE_DIR: '.data/shots' })).toEqual({ kind: 'pglite', dir: '.data/shots' })
    expect(defaultDbTarget({ NODE_ENV: 'production' })).toBeNull()
    expect(defaultDbTarget({ NODE_ENV: 'production', PGLITE_DIR: '  ', DATABASE_URL: '' })).toBeNull()
    // Never on a Vercel deployment: a stray PGLITE_DIR there must fail loudly, not run on a throwaway database.
    expect(defaultDbTarget({ NODE_ENV: 'production', PGLITE_DIR: '.data/shots', VERCEL: '1' })).toBeNull()
  })

  it('enforces one display name per group at the database level', async () => {
    await db.query(`INSERT INTO groups (id, invite_token, name, year) VALUES ('uq', 'uq-token', 'T', 2026)`)
    const insert = () =>
      db.query(`INSERT INTO submissions (group_id, display_name, name_key, answers) VALUES ('uq', 'Sam', 'sam', '{}'::jsonb)`)
    await insert()
    await expect(insert()).rejects.toMatchObject({ code: '23505' })
  })
})
