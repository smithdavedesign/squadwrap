// Screenshot proof: `npm run screenshots` (not part of `npm test`).
// Builds the app, starts the production server (`next start`) on a throwaway local PGlite database with a stub
// AI model and a placeholder payment link, checks the launch tags over real HTTP (titles, descriptions, canonical
// URLs, Open Graph and Twitter tags, JSON-LD, robots.txt, sitemap.xml, the share image, saved to .data/ for a look),
// then drives it with Playwright's Chromium (CHROMIUM_PATH; no browser is ever downloaded):
//   home      the start page, with the footer (privacy, terms, report)
//   join      a friend answering the prompts, photo added and the 18+ box ticked (then sending)
//   awards    the organizer clicking "Make the awards": the awards, the slide downloads and the $6 Buy button
// each at 1280×800 and on an iPhone 13, viewport only, into docs/screenshots/. Sample people, drawn avatars and
// local throwaway links only; the link fields are masked anyway. Stops everything and exits non-zero on failure.
// Chromium sets navigator.webdriver, so no RepoHQ signal is sent (nor would a local build send one).
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium, devices } from 'playwright-core'
import sharp from 'sharp'

const APP_PORT = 3198
const MODEL_PORT = 4198
const APP = `http://127.0.0.1:${APP_PORT}`
const OUT = 'docs/screenshots'
const DB_DIR = '.data/screenshots-pglite'
// What Vercel would set: the production domain (a reserved example name here), for build and server alike.
const SITE_ENV = { VERCEL_PROJECT_PRODUCTION_URL: 'squadwrap.example' }
const SITE = 'https://squadwrap.example'
// A placeholder, so the Buy button shows; nothing is ever bought.
const PAYMENT_LINK = 'https://example.com/pay'

const FRIENDS = {
  Ana: {
    color: '#ff8fa3',
    hair: '#4a2c2a',
    answers: {
      cancels: 'Ben, every single brunch. "My landlord is coming over." He owns the flat.',
      lore: 'Cat’s five-minute risotto, the smoke alarm, and all of us eating cereal on the stairs at midnight.',
      mainCharacter: 'Got the last two tickets to the sold-out gig and made the whole queue cheer.',
      threeWords: 'loud, broke, thriving',
      secretAward: 'Best Group Chat Lurker',
    },
    award: ['The Human Snooze Button', 'Cancelled brunch three times for “a sad cat”. The cat was fine; we forgave her anyway.'],
  },
  Ben: {
    color: '#7cc6fe',
    hair: '#1f1f1f',
    answers: {
      cancels: 'Me, honestly. The landlord excuse worked four times.',
      lore: 'The karaoke night that ended in a 24-hour laundromat.',
      mainCharacter: 'Fixed the boiler with a YouTube video and a butter knife.',
      threeWords: 'tired but iconic',
      secretAward: 'Flat DIY Hero',
    },
    award: ['Landlord of Excuses', 'Blamed every no-show on a landlord visit to the flat he owns. Still first on the karaoke list.'],
  },
  Cat: {
    color: '#ffd166',
    hair: '#b5651d',
    answers: {
      cancels: 'Dev, who was “five minutes away” for an entire birthday dinner.',
      lore: 'My risotto. I stand by it. The fire brigade did not.',
      mainCharacter: 'Ran the flat’s first ever pub quiz and lost my own quiz.',
      threeWords: 'smoky, proud, hungry',
      secretAward: 'Head Chef',
    },
    award: ['Michelin Star in Smoke Alarms', 'Her five-minute risotto took ninety minutes and the fire alarm. Best cereal night we ever had.'],
  },
  Dev: {
    color: '#95d5b2',
    hair: '#2d1e12',
    answers: {
      cancels: 'Ana. The sad cat is legendary at this point.',
      lore: 'The 3 a.m. voice notes. All 47 of them.',
      mainCharacter: 'Said yes to a ballroom class and accidentally won the raffle.',
      threeWords: 'always five minutes',
      secretAward: 'Night Owl Laureate',
    },
    award: ['Group Chat Night Owl', 'Sends voice notes at 3 a.m. and calls them podcasts. Somehow we listen to every one.'],
  },
  Eli: {
    color: '#cdb4db',
    hair: '#6b3e26',
    answers: {
      cancels: 'Ben. The landlord. We all know.',
      lore: 'Smoke alarm risotto night. Peak flat.',
      mainCharacter: 'Ran the half marathon in a T. rex costume and made the local news.',
      threeWords: 'tiny arms, huge heart',
      secretAward: 'Dinosaur of the Year',
    },
    award: ['Dinosaur of the Year', 'Ran a half marathon in a T. rex suit and made the local news. Tiny arms, huge legacy.'],
  },
}

/** A drawn cartoon avatar (no real person), as JPEG bytes. */
function avatar({ color, hair }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="400" height="400" fill="${color}"/>
    <ellipse cx="200" cy="420" rx="150" ry="110" fill="#2c1460"/>
    <circle cx="200" cy="200" r="110" fill="#f1c7a3"/>
    <path d="M90 190 Q100 70 200 75 Q300 70 310 190 Q290 120 200 118 Q110 120 90 190 Z" fill="${hair}"/>
    <circle cx="160" cy="205" r="12" fill="#1d1630"/><circle cx="240" cy="205" r="12" fill="#1d1630"/>
    <path d="M150 255 Q200 300 250 255" stroke="#1d1630" stroke-width="10" fill="none" stroke-linecap="round"/>
  </svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()
}

// The stub model answers like the real one: one award per friend id it was sent.
const model = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const user = JSON.parse(body).messages.at(-1).content
    const data = JSON.parse(user.slice(user.indexOf('{')))
    const awards = data.friends.map((f) => {
      const [title, citation] = FRIENDS[f.name]?.award ?? [`The ${f.name} Award`, `For ${f.name}, who made the year.`]
      return { id: f.id, name: f.name, title, citation }
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ awards }) } }] }))
  })
})

let serverLog = ''
function run(command, args, env = {}) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (c) => (serverLog += c))
  child.stderr.on('data', (c) => (serverLog += c))
  return child
}

const exited = (child) => new Promise((resolve) => child.on('exit', (code) => resolve(code)))

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(APP + '/')).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('the app did not start')
}

async function post(path, body) {
  const res = await fetch(APP + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}

function check(ok, what) {
  if (!ok) throw new Error(`launch check failed: ${what}`)
}

/** The content of `<meta name|property="key">` in `html` (Next writes the attribute before content). */
function meta(html, key) {
  return html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1]
}

/** The launch tags as the production server sends them (the unit tests only see the metadata objects). */
async function checkLaunchTags(inviteToken) {
  const titles = new Set()
  for (const path of ['/', '/privacy', '/terms']) {
    const html = await (await fetch(APP + path)).text()
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1]
    check(title && !titles.has(title), `${path}: a unique <title>`)
    titles.add(title)
    check(meta(html, 'description'), `${path}: meta description`)
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1]
    check(canonical?.replace(/\/$/, '') === SITE + (path === '/' ? '' : path), `${path}: canonical URL`)
    for (const key of ['og:title', 'og:description', 'og:url', 'og:site_name', 'og:type', 'twitter:title', 'twitter:description']) {
      check(meta(html, key), `${path}: ${key}`)
    }
    check(meta(html, 'og:image')?.startsWith(`${SITE}/opengraph-image`), `${path}: og:image`)
    check(meta(html, 'og:image:width') === '1200' && meta(html, 'og:image:height') === '630', `${path}: og:image is 1200×630`)
    check(meta(html, 'twitter:card') === 'summary_large_image', `${path}: twitter:card`)
    check(meta(html, 'twitter:image')?.startsWith(`${SITE}/opengraph-image`), `${path}: twitter:image`)
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)?.[1] ?? 'null')
    check(ld?.['@type'] === 'SoftwareApplication' && ld.offers?.price === '6.00' && ld.offers.priceCurrency === 'USD', `${path}: JSON-LD`)
  }
  const robots = await (await fetch(APP + '/robots.txt')).text()
  check(robots.includes('Allow: /') && robots.includes(`Sitemap: ${SITE}/sitemap.xml`), 'robots.txt')
  const sitemap = await (await fetch(APP + '/sitemap.xml')).text()
  check(['/', '/privacy', '/terms'].every((p) => sitemap.includes(`<loc>${SITE}${p}</loc>`)), 'sitemap.xml lists the public pages')
  const image = await fetch(APP + '/opengraph-image')
  const bytes = Buffer.from(await image.arrayBuffer())
  const { width, height, format } = await sharp(bytes).metadata()
  check(image.ok && format === 'png' && width === 1200 && height === 630, '/opengraph-image is a 1200×630 PNG')
  await mkdir('.data', { recursive: true })
  await writeFile('.data/share-image.png', bytes)
  // A private-link page: kept out of search engines, and no canonical URL pointing at someone's key.
  const invite = await fetch(`${APP}/join/${inviteToken}`)
  const inviteHtml = await invite.text()
  check(invite.headers.get('x-robots-tag') === 'noindex, nofollow' && !inviteHtml.includes('rel="canonical"'), 'invite page: noindex, no canonical')
  console.log('Launch tags checked over HTTP; share image saved to .data/share-image.png')
}

/** Scrolls so `selector` sits just below the top of the viewport. */
async function scrollTo(page, selector) {
  await page.locator(selector).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20))
  await page.waitForTimeout(150)
}

let app
let browser
try {
  if (!process.env.CHROMIUM_PATH) throw new Error('Set CHROMIUM_PATH to a Chromium binary; this script never downloads one.')
  await rm(DB_DIR, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  console.log('Building…')
  // Not a preview or production deployment: the RepoHQ signal stays off in this build.
  const build = run('node_modules/.bin/next', ['build'], { ...SITE_ENV, NEXT_PUBLIC_VERCEL_ENV: '' })
  if ((await exited(build)) !== 0) throw new Error('next build failed')

  await new Promise((resolve) => model.listen(MODEL_PORT, '127.0.0.1', resolve))
  app = run('node_modules/.bin/next', ['start', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
    // A fresh local database and the stub model; empty values keep the run off any real database or Stripe.
    PGLITE_DIR: DB_DIR,
    DATABASE_URL: '',
    LLM_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
    LLM_MODEL: 'stub',
    LLM_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_PAYMENT_LINK: PAYMENT_LINK,
    ...SITE_ENV,
  })
  await waitForApp()

  // Four friends have answered; Eli answers in the browser.
  const group = await post('/groups', { name: 'Flat 4B', year: 2026, memberCount: 5 })
  for (const name of ['Ana', 'Ben', 'Cat', 'Dev']) {
    const photo = `data:image/jpeg;base64,${(await avatar(FRIENDS[name])).toString('base64')}`
    await post(`/join/${group.inviteToken}/submissions`, { displayName: name, answers: FRIENDS[name].answers, photo, adult: true })
  }
  await checkLaunchTags(group.inviteToken)

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  const sizes = { desktop: { viewport: { width: 1280, height: 800 } }, mobile: devices['iPhone 13'] }
  // Link fields hold this run's throwaway keys; masked in the input's own colour.
  const shoot = (page, name) =>
    page.screenshot({ path: `${OUT}/${name}.png`, mask: [page.locator('.copy input, .nudge textarea')], maskColor: '#120d1f' })

  for (const [size, options] of Object.entries(sizes)) {
    const context = await browser.newContext(options)
    const page = await context.newPage()

    await page.goto(APP + '/')
    await page.getByPlaceholder('Flat 4B').fill('Flat 4B')
    await shoot(page, `home-${size}`)

    await page.goto(`${APP}/join/${group.inviteToken}`)
    await page.getByLabel('Your name').fill('Eli')
    for (const [id, text] of Object.entries(FRIENDS.Eli.answers)) await page.locator(`textarea[name="${id}"]`).fill(text)
    await page.locator('input[type="file"]').setInputFiles({ name: 'eli.jpg', mimeType: 'image/jpeg', buffer: await avatar(FRIENDS.Eli) })
    await page.locator('.photo-preview img').waitFor()
    await page.locator('input[name="adult"]').check()
    await scrollTo(page, 'label:has(textarea[name="threeWords"])')
    await shoot(page, `join-${size}`)
    if (size === 'desktop') {
      await page.getByRole('button', { name: 'Send my answers' }).click()
      await page.getByText('You’re in, Eli!').waitFor()
    }

    await page.goto(`${APP}/groups/${group.id}`)
    if (size === 'desktop') {
      await page.getByRole('button', { name: 'Make the awards' }).click()
      await page.getByText('Download slide').first().waitFor({ timeout: 30_000 })
    }
    const buy = page.getByRole('link', { name: 'Buy the unlock, $6' })
    await buy.waitFor()
    check((await buy.getAttribute('href')) === `${PAYMENT_LINK}?client_reference_id=${group.id}`, 'Buy links to the payment link with the group')
    await scrollTo(page, 'h2:has-text("Make the awards")')
    await shoot(page, `awards-${size}`)

    await context.close()
  }
  console.log(`Saved 6 screenshots in ${OUT}/`)
} catch (err) {
  console.error(err)
  console.error('\n--- app log (tail) ---\n' + serverLog.slice(-3000))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (app && app.exitCode === null && app.signalCode === null) {
    const stopped = exited(app)
    app.kill('SIGTERM')
    await stopped
  }
  model.close()
  await rm(DB_DIR, { recursive: true, force: true })
}
