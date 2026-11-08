// The Worker's entry point (wrangler.jsonc `main`): OpenNext's worker for every request, plus the Cron Triggers.
// .open-next/worker.js only exists after `npm run cf:build`.
import app from '../.open-next/worker.js'
import { runScheduled } from './scheduled.mjs'

export default {
  fetch: app.fetch,
  /** @param {{ cron: string }} controller @param {Record<string, unknown>} env @param {{ waitUntil(p: Promise<unknown>): void }} ctx */
  async scheduled(controller, env, ctx) {
    await runScheduled(app, controller, env, ctx)
  },
}
