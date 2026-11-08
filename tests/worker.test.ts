// The Cloudflare Worker (since 2026-11-08): its wrangler config, the Cron Trigger that replaced Vercel Cron, and the
// production defaults the Worker's build gets (canonical host, slide credit, visit beacon, no PGlite).
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { CRON_ROUTES, runScheduled } from '../cloudflare/scheduled.mjs'
import { defaultDbTarget } from '../lib/db'
import { deployEnv, signalsAllowed, type SignalWindow } from '../lib/signal'
import { WORKER_HOST, siteUrl } from '../lib/site'
import { creditHost } from '../lib/slide'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

/** wrangler.jsonc as JSON: line comments and trailing commas removed (no string in it contains `//` after a quote). */
async function wranglerConfig() {
  const text = (await read('wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(text)
}

describe('wrangler.jsonc', () => {
  it('names the Worker after the repo, runs the cron wrapper and turns on the Node.js APIs', async () => {
    const config = await wranglerConfig()
    expect(config.name).toBe('squadwrap')
    expect(config.main).toBe('cloudflare/worker.mjs')
    expect(config.compatibility_flags).toContain('nodejs_compat')
    expect(config.services).toContainEqual({ binding: 'WORKER_SELF_REFERENCE', service: 'squadwrap' })
    // The broker refuses a config with a build command: the build is `npm run cf:build`, run beforehand.
    expect(config.build).toBeUndefined()
    // Plain settings only: every secret is a Worker secret, never in this file.
    expect(Object.keys(config.vars ?? {})).toEqual(['LLM_MODEL'])
  })

  it('schedules every Vercel Cron job as a Cron Trigger, each mapped to its route', async () => {
    const vercel = JSON.parse(await read('vercel.json')) as { crons: { path: string; schedule: string }[] }
    const config = await wranglerConfig()
    expect([...config.triggers.crons].sort()).toEqual(vercel.crons.map((c) => c.schedule).sort())
    for (const { path, schedule } of vercel.crons) expect(CRON_ROUTES[schedule as keyof typeof CRON_ROUTES]).toBe(path)
  })
})

describe('the scheduled handler', () => {
  const app = (status = 200, body = '{"deletedGroups":0}') => {
    const fetch = vi.fn(async (_req: Request, _env: unknown, _ctx: unknown) => new Response(body, { status }))
    return { fetch }
  }

  it('calls the route inside the Worker with the cron secret, as Vercel Cron did', async () => {
    const worker = app()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const env = { CRON_SECRET: ' s3cret ' }
    await runScheduled(worker, { cron: '17 4 * * *' }, env, {})
    const [req, passedEnv] = worker.fetch.mock.calls[0]
    expect(new URL(req.url).pathname).toBe('/cron/cleanup')
    expect(req.method).toBe('GET')
    expect(req.headers.get('authorization')).toBe('Bearer s3cret')
    expect(passedEnv).toBe(env)
  })

  it('sends no header without CRON_SECRET, and fails loudly when the route refuses', async () => {
    const worker = app(503, '{"error":{"code":"cron_not_configured"}}')
    await expect(runScheduled(worker, { cron: '17 4 * * *' }, {}, {})).rejects.toThrow(/answered 503.*cron_not_configured/)
    expect(worker.fetch.mock.calls[0][0].headers.has('authorization')).toBe(false)
  })

  it('refuses a cron it has no route for', async () => {
    await expect(runScheduled(app(), { cron: '* * * * *' }, {}, {})).rejects.toThrow(/No route/)
  })
})

describe('production defaults on the Worker', () => {
  it('the deploy env is NEXT_PUBLIC_DEPLOY_ENV (set by `npm run cf:build`), else Vercel’s', () => {
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
    expect(deployEnv()).toBe('production')
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENV', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    expect(deployEnv()).toBe('preview')
    vi.unstubAllEnvs()
  })

  it('the beacon counts the Worker’s visitors', () => {
    const store = { getItem: () => null, setItem: () => {} }
    const win = { navigator: { webdriver: false }, localStorage: store } as unknown as SignalWindow
    expect(signalsAllowed(win, 'production')).toBe(true)
  })

  it('canonical URLs and the slide credit use the Worker’s address; Vercel’s production domain still wins there', () => {
    expect(siteUrl({}, 'production').href).toBe(`https://${WORKER_HOST}/`)
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'squadwrap.example' }, 'production').href).toBe('https://squadwrap.example/')
    expect(siteUrl({}, undefined).href).toBe('http://localhost:3000/')
    expect(creditHost(`https://${WORKER_HOST}/groups/a/awards/b.png`, {}, 'production')).toBe(WORKER_HOST)
    expect(creditHost('http://localhost:3000/x', {}, undefined)).toBe('localhost:3000')
  })

  it('never falls back to PGlite on the Worker', () => {
    expect(defaultDbTarget({ NODE_ENV: 'development', PGLITE_DIR: '/tmp/x' }, true)).toBeNull()
    expect(defaultDbTarget({ DATABASE_URL: 'postgres://db' }, true)).toEqual({ kind: 'postgres', url: 'postgres://db' })
    expect(defaultDbTarget({ NODE_ENV: 'development' }, false)).toEqual({ kind: 'pglite', dir: '.data/pglite' })
  })
})
