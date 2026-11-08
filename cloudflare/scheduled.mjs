// Cron Triggers for the Cloudflare Worker: what Vercel Cron did from vercel.json. Each cron (wrangler.jsonc
// `triggers.crons`) maps to the app route it runs, which is called inside the Worker, never over the network,
// with `Authorization: Bearer $CRON_SECRET` exactly as Vercel Cron sent it.

/** cron expression → the route it runs. Keep in step with vercel.json and wrangler.jsonc (tests/worker.test.ts). */
export const CRON_ROUTES = { '17 4 * * *': '/cron/cleanup' }

/** Any origin works for an in-Worker request; this one is the Worker's own. */
const ORIGIN = 'https://squadwrap.1426davejobs.workers.dev'

/**
 * Runs the route for `controller.cron` through the app's own fetch handler. A failure is thrown, so the
 * Worker's logs and Cron Events show it. Without CRON_SECRET the route answers 503 and nothing is deleted.
 * @param {{ fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }} app the OpenNext worker
 * @param {{ cron: string }} controller
 * @param {Record<string, unknown>} env
 * @param {unknown} ctx
 * @returns {Promise<Response>}
 */
export async function runScheduled(app, controller, env, ctx) {
  const path = CRON_ROUTES[/** @type {keyof typeof CRON_ROUTES} */ (controller.cron)]
  if (!path) throw new Error(`No route for the cron "${controller.cron}"`)
  const secret = typeof env.CRON_SECRET === 'string' ? env.CRON_SECRET.trim() : ''
  const headers = secret ? { authorization: `Bearer ${secret}` } : {}
  const res = await app.fetch(new Request(new URL(path, ORIGIN), { headers }), env, ctx)
  const body = await res.text()
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${body.slice(0, 200)}`)
  console.info(`${path}: ${body.slice(0, 200)}`)
  return res
}
