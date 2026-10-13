import { ConfigError, getDefaultDb, type Db } from './db'
import { createOpenAiCompatibleModel, modelConfigFromEnv, type ChatModel } from './model'
import { paymentsFromEnv, type Payments } from './payments'
import { AppError, type Body } from './squad'

type Deps = { db: Db; model: ChatModel | null; payments: Payments | null }
let overrides: Partial<Deps> = {}

/** Tests swap in a PGlite database, a stub model and stub (or no) payments here. */
export function setDeps(next: Partial<Deps>): void {
  overrides = next
}

export async function getDb(): Promise<Db> {
  if (overrides.db) return overrides.db
  try {
    return await getDefaultDb()
  } catch (err) {
    if (err instanceof ConfigError) throw new AppError(503, 'db_not_configured', 'The database is not configured.')
    throw err
  }
}

export function getModel(): ChatModel | null {
  if ('model' in overrides) return overrides.model ?? null
  const config = modelConfigFromEnv(process.env)
  return config ? createOpenAiCompatibleModel(config) : null
}

export function getPayments(): Payments | null {
  if ('payments' in overrides) return overrides.payments ?? null
  return paymentsFromEnv(process.env)
}

export async function readJsonObject(req: Request): Promise<Body> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new AppError(400, 'invalid_json', 'The request body must be JSON.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError(400, 'invalid_input', 'The request body must be a JSON object.')
  }
  return body as Body
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status })
  }
  console.error('Unhandled error', err)
  return Response.json({ error: { code: 'internal', message: 'Something went wrong.' } }, { status: 500 })
}

/** Wraps a route handler so thrown AppErrors become JSON error responses. */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx)
    } catch (err) {
      return errorResponse(err)
    }
  }
}
