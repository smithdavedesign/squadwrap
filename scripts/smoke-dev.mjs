// Smoke run against a real `next dev` server: `npm run smoke` (not part of `npm test`).
// Starts a stub OpenAI-compatible model and the dev server (local PGlite in .data/pglite, no network),
// walks the M1–M4 flow over HTTP, checks real status codes, HTML and headers, then stops both and
// exits non-zero on any failure. It leaves a "Smoke Flat" group in the local dev database, and its cleanup-job
// check deletes any group there whose 30 days are up, as the job would.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import sharp from 'sharp'
import Stripe from 'stripe'

const APP_PORT = 3197
const MODEL_PORT = 4197
const APP = `http://127.0.0.1:${APP_PORT}`
// Stand-ins built at runtime, valid only for this run's server: never real secrets.
const WEBHOOK_SECRET = ['whsec', 'smokeRun'.repeat(4)].join('_')
const CRON_SECRET = ['cron', 'smokeRun'.repeat(4)].join('_')

// Answers like a model would: one award per friend id it was sent.
const model = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const user = JSON.parse(body).messages.at(-1).content
    const data = JSON.parse(user.slice(user.indexOf('{')))
    const awards = data.friends.map((f) => ({ id: f.id, title: `Smoke ${f.name} Award`, citation: `For ${f.name}. Truly.` }))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ awards }) } }] }))
  })
}).listen(MODEL_PORT, '127.0.0.1')

const dev = spawn('node_modules/.bin/next', ['dev', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
  // An empty DATABASE_URL keeps the run on the local PGlite database, and an empty STRIPE_SECRET_KEY keeps it away
  // from Stripe, whatever the shell has set.
  env: {
    ...process.env,
    LLM_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
    LLM_MODEL: 'stub',
    DATABASE_URL: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CRON_SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let devLog = ''
dev.stdout.on('data', (c) => (devLog += c))
dev.stderr.on('data', (c) => (devLog += c))

const results = []
const check = (label, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)

async function http(method, path, body, headers = {}) {
  const res = await fetch(APP + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json() : type.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.text()
  return { status: res.status, headers: res.headers, data }
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(APP + '/')
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('dev server did not start')
}

try {
  await waitForServer()
  const photo = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#d06030' } }).jpeg().toBuffer()

  const created = await http('POST', '/groups', { name: 'Smoke Flat', memberCount: 5 })
  check('POST /groups 201 with yearbookToken', created.status === 201 && /^[\w-]{22}$/.test(created.data.yearbookToken))
  const { id, inviteToken, yearbookToken } = created.data

  const answers = { cancels: 'x', lore: 'y', mainCharacter: 'z', threeWords: 'a b c', secretAward: 'w' }
  const unticked = await http('POST', `/join/${inviteToken}/submissions`, { displayName: 'Kid', answers })
  check('M4 EC4: submitting without the adults-only box → 400', unticked.status === 400 && unticked.data.error?.code === 'adults_only', String(unticked.status))
  for (const [name, withPhoto] of [['Ana', true], ['Ben', false], ['Jo/Jo 100%', false]]) {
    const r = await http('POST', `/join/${inviteToken}/submissions`, {
      displayName: name,
      answers,
      photo: withPhoto ? `data:image/jpeg;base64,${photo.toString('base64')}` : undefined,
      adult: true,
    })
    check(`submit ${name}`, r.status === 201, String(r.status))
  }

  const pending = await http('GET', `/groups/${id}/pending`)
  check('M3 EC2: GET /groups/:id/pending → pending 2', pending.status === 200 && pending.data.pending === 2, JSON.stringify(pending.data.nudge))
  check('pending carries X-Robots-Tag', pending.headers.get('x-robots-tag') === 'noindex, nofollow')

  const gen = await http('POST', `/groups/${id}/generate`)
  check('generate 200 with 3 awards', gen.status === 200 && gen.data.awards?.length === 3, String(gen.status))

  const yb = await http('GET', `/y/${yearbookToken}`)
  const html = yb.data
  check('M3 EC1: GET /y/:token → 200', yb.status === 200, String(yb.status))
  check('M3 EC1: lists all 3 awards', ['Smoke Ana Award', 'Smoke Ben Award', 'Smoke Jo/Jo 100% Award'].every((t) => html.includes(t)))
  const robotsAt = html.indexOf('<meta name="robots" content="noindex, nofollow"/>')
  check('M3 EC3: noindex meta tag in the HTML', robotsAt >= 0, robotsAt >= 0 && robotsAt < html.indexOf('</head>') ? 'inside <head>' : 'outside <head>')
  check('M3 EC3: report link', html.includes(`href="/y/${yearbookToken}/report"`))
  check('yearbook X-Robots-Tag header', yb.headers.get('x-robots-tag') === 'noindex, nofollow')
  check('yearbook Referrer-Policy header', yb.headers.get('referrer-policy') === 'no-referrer')
  check('yearbook HTML has no organizer id or invite token', !html.includes(id) && !html.includes(inviteToken))

  const wrong = await http('GET', '/y/not-a-real-token-0000000')
  check('M3 EC1: wrong token → 404', wrong.status === 404, String(wrong.status))
  check('the 404 page is noindex too', /<meta name="robots" content="noindex/.test(wrong.data))
  check('organizer id as yearbook token → 404', (await http('GET', `/y/${id}`)).status === 404)

  const png = await http('GET', `/y/${yearbookToken}/Ana.png`)
  const meta = png.status === 200 ? await sharp(png.data).metadata() : {}
  check('slide PNG via the yearbook, 1080x1920', png.status === 200 && meta.width === 1080 && meta.height === 1920, png.headers.get('content-type'))
  check('slide PNG carries X-Robots-Tag', png.headers.get('x-robots-tag') === 'noindex, nofollow')
  const odd = await http('GET', `/y/${yearbookToken}/${encodeURIComponent('Jo/Jo 100%')}.png`)
  check('slide for "Jo/Jo 100%" (encoded / and %)', odd.status === 200, String(odd.status))
  const jpg = await http('GET', `/y/${yearbookToken}/Ana.jpg`)
  check('photo JPEG via the yearbook', jpg.status === 200 && jpg.headers.get('content-type') === 'image/jpeg' && jpg.headers.get('x-content-type-options') === 'nosniff')

  const reportPage = await http('GET', `/y/${yearbookToken}/report`)
  check('report page 200 with noindex', reportPage.status === 200 && reportPage.data.includes('content="noindex, nofollow"'))
  const report = await http('POST', `/y/${yearbookToken}/reports`, { reason: 'Smoke test report' })
  check('POST report → 201', report.status === 201, String(report.status))

  const dash = await http('GET', `/groups/${id}`)
  check('organizer page links slides under /y/', dash.data.includes(`href="/y/${yearbookToken}/Ana.png"`) && !dash.data.includes(`/groups/${id}/awards/`))
  check('organizer page nudge text', dash.data.includes('3 of 5 have answered') && dash.data.includes('2 to go!'))
  check('organizer page yearbook section', dash.data.includes('Share the yearbook'))

  // M4: payment and safety, over real HTTP (the webhook's raw body is what Next.js hands the route).
  check('organizer page offers the unlock', dash.data.includes('Unlock for $12') && dash.data.includes('is deleted on'))
  const checkout = await http('POST', `/groups/${id}/checkout`)
  check('checkout without a Stripe key → 503', checkout.status === 503 && checkout.data.error?.code === 'payments_not_configured', String(checkout.status))
  const event = JSON.stringify({
    id: 'evt_smoke_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_smoke_1',
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        client_reference_id: id,
        metadata: { app: 'squadwrap' },
      },
    },
  })
  const sign = (secret) => Stripe.webhooks.generateTestHeaderString({ payload: event, secret })
  const forged = await http('POST', '/webhooks/stripe', event, { 'stripe-signature': sign(['whsec', 'notOurs'.repeat(4)].join('_')) })
  check('M4 EC2: webhook with a bad signature → 400', forged.status === 400, String(forged.status))
  const stillLocked = await http('GET', `/y/${yearbookToken}/Ben.png`)
  check('M4 EC2: … and the slide is still watermarked', stillLocked.headers.get('x-squadwrap-watermark') === 'preview')
  const paid = await http('POST', '/webhooks/stripe', event, { 'stripe-signature': sign(WEBHOOK_SECRET) })
  check('M4 EC1: signed checkout.session.completed → unlocked', paid.status === 200 && paid.data.outcome === 'unlocked', JSON.stringify(paid.data))
  const replay = await http('POST', '/webhooks/stripe', event, { 'stripe-signature': sign(WEBHOOK_SECRET) })
  check('M4 EC1: replay → 200 already_unlocked', replay.status === 200 && replay.data.outcome === 'already_unlocked', JSON.stringify(replay.data))
  const unlockedSlide = await http('GET', `/y/${yearbookToken}/Ben.png`)
  check('unlocked slide has no watermark header', unlockedSlide.status === 200 && unlockedSlide.headers.get('x-squadwrap-watermark') === null)
  check('organizer page says unlocked', (await http('GET', `/groups/${id}`)).data.includes('Unlocked:'))

  const cronDenied = await http('GET', '/cron/cleanup', undefined, { authorization: 'Bearer wrong' })
  check('cleanup job without the cron secret → 401', cronDenied.status === 401, String(cronDenied.status))
  const cron = await http('GET', '/cron/cleanup', undefined, { authorization: `Bearer ${CRON_SECRET}` })
  check('M4 EC3: cleanup job runs → 200 { deletedGroups }', cron.status === 200 && Number.isInteger(cron.data.deletedGroups), JSON.stringify(cron.data))
  check('… and keeps today’s group', (await http('GET', `/y/${yearbookToken}`)).status === 200)

  const privacy = await http('GET', '/privacy')
  const terms = await http('GET', '/terms')
  check('privacy and terms pages 200', privacy.status === 200 && terms.status === 200)
  const home = await http('GET', '/')
  check('footer on the home page links privacy, terms and takedowns', ['href="/privacy"', 'href="/terms"', 'href="/terms#report"'].every((h) => home.data.includes(h)))
} catch (err) {
  results.push(`FAIL  ${err.stack}`)
} finally {
  dev.kill('SIGTERM')
  model.close()
}
console.log(results.join('\n'))
const failed = results.filter((r) => !r.startsWith('PASS')).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
if (failed) {
  console.log('\n--- dev server log (tail) ---\n' + devLog.slice(-3000))
  process.exitCode = 1
}
