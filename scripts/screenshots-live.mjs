// Screenshots of the main flow on the live site (the Cloudflare Worker), at 1440×900 and on an iPhone 13, into
// docs/screenshots/live/ (README "Live"). Unlike `npm run screenshots`, this makes a real group in the production
// database and calls the real model (Gemini, free tier); the group is deleted with everything else after 30 days.
//
//   CHROMIUM_PATH=<Chrome for Testing binary> node scripts/screenshots-live.mjs [site]
//
// The browser is automated (navigator.webdriver), so the RepoHQ visit beacon sends nothing.
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { chromium, devices } from 'playwright-core'

const SITE = (process.argv[2] ?? 'https://squadwrap.1426davejobs.workers.dev').replace(/\/$/, '')
const OUT = 'docs/screenshots/live'
const UA_TAG = 'botchelor-live-check'

const FRIENDS = {
  Ana: { color: '#ff8fa3', hair: '#4a2c2a', answers: { cancels: 'Ben. "My plant is sad." Every single time.', lore: 'The karaoke night that ended in a 24-hour laundromat.', mainCharacter: 'Ran for the last train in heels and made it, to applause.', threeWords: 'loud, loyal, late', secretAward: 'Ben deserves Best Group Chat Lurker' } },
  Ben: { color: '#9bd0ff', hair: '#1d1630', answers: { cancels: 'Me, honestly. I have a plant.', lore: 'Cat’s five-minute risotto, the smoke alarm, and cereal on the stairs.', mainCharacter: 'Ana at the laundromat, singing to the dryers.', threeWords: 'tiny, mighty, sleepy', secretAward: 'Cat for Michelin Star in Smoke Alarms' } },
  Cat: { color: '#ffd84d', hair: '#7a3b12', answers: { cancels: 'Ben and his plant.', lore: 'Smoke alarm risotto night. Peak flat.', mainCharacter: 'Ben replying "lol" to a 40-message argument a day later.', threeWords: 'chaotic good chef', secretAward: 'Ana for Last Train Olympian' } },
}
const ELI = { color: '#b9f6ca', hair: '#3b2a1a', answers: { cancels: 'Whoever said “brunch” first.', lore: 'The time we all dressed as the same person by accident.', mainCharacter: 'Cat explaining risotto to the firefighters.', threeWords: 'calm, tall, snacks', secretAward: 'Ana for Most Voice Notes Sent' } }

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

async function post(path, body) {
  const res = await fetch(SITE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': `${UA_TAG} (screenshots-live)` },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}

async function scrollTo(page, selector) {
  await page.locator(selector).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20))
  await page.waitForTimeout(150)
}

if (!process.env.CHROMIUM_PATH) throw new Error('Set CHROMIUM_PATH to a Chromium binary; this script never downloads one.')
await mkdir(OUT, { recursive: true })

const group = await post('/groups', { name: 'Flat 4B', memberCount: 4 })
for (const [name, friend] of Object.entries(FRIENDS)) {
  const photo = `data:image/jpeg;base64,${(await avatar(friend)).toString('base64')}`
  await post(`/join/${group.inviteToken}/submissions`, { displayName: name, answers: friend.answers, photo, adult: true })
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const errors = []
try {
  const sizes = { desktop: { viewport: { width: 1440, height: 900 } }, phone: devices['iPhone 13'] }
  // Link fields hold this group's keys; masked in the input's own colour.
  const shoot = (page, name) =>
    page.screenshot({ path: `${OUT}/${name}.png`, mask: [page.locator('.copy input, .nudge textarea')], maskColor: '#120d1f' })

  for (const [size, options] of Object.entries(sizes)) {
    const context = await browser.newContext({ ...options, userAgent: `${options.userAgent ?? ''} ${UA_TAG}`.trim() })
    const page = await context.newPage()
    page.on('pageerror', (err) => errors.push(`${size}: ${err.message}`))

    await page.goto(SITE + '/')
    await page.getByPlaceholder('Flat 4B').fill('Flat 4B')
    await shoot(page, `home-${size}`)

    await page.goto(`${SITE}/join/${group.inviteToken}`)
    await page.getByLabel('Your name').fill('Eli')
    for (const [id, text] of Object.entries(ELI.answers)) await page.locator(`textarea[name="${id}"]`).fill(text)
    await page.locator('input[type="file"]').setInputFiles({ name: 'eli.jpg', mimeType: 'image/jpeg', buffer: await avatar(ELI) })
    await page.locator('.photo-preview img').waitFor()
    await page.locator('input[name="adult"]').check()
    await scrollTo(page, 'label:has(textarea[name="threeWords"])')
    await shoot(page, `join-${size}`)
    if (size === 'desktop') {
      await page.getByRole('button', { name: 'Send my answers' }).click()
      await page.getByText('You’re in, Eli!').waitFor()
    }

    await page.goto(`${SITE}/groups/${group.id}`)
    if (size === 'desktop') {
      await page.getByRole('button', { name: 'Make the awards' }).click()
      await page.getByText('Download slide').first().waitFor({ timeout: 60_000 })
    }
    await page.getByRole('link', { name: 'Buy the unlock, $6' }).waitFor()
    await scrollTo(page, 'h2:has-text("Make the awards")')
    await shoot(page, `awards-${size}`)

    // One friend's story slide, as the Worker draws it.
    await page.goto(`${SITE}/groups/${group.id}/awards/Ana.png`)
    await shoot(page, `slide-${size}`)

    await context.close()
  }
} finally {
  await browser.close()
}
if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`)
console.log(`Saved 8 screenshots in ${OUT}/ (group made on ${SITE})`)
