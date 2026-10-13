// Payment proof on the live site: `npm run payment:live` (not part of `npm test`; needs Stripe in test mode).
// Makes a group, 3 friends answer over the API, the organizer clicks "Make the awards" and Buy, pays on Stripe's
// test checkout with card 4242 4242 4242 4242, then waits for the webhook to unlock the group. Desktop and phone;
// screenshots go to docs/screenshots/payment-*.png. SITE overrides the URL; CHROMIUM_PATH the browser.
import fs from 'node:fs'
import { chromium, devices } from 'playwright-core'
const SITE = process.env.SITE || 'https://squadwrap.vercel.app'
const OUT = process.argv[2] || 'docs/screenshots'
fs.mkdirSync(OUT, { recursive: true })

const answers = (who) => ({
  cancels: `${who}: Ben, every brunch. "My landlord is coming over." He owns the flat.`,
  lore: 'The five-minute risotto, the smoke alarm, and cereal on the stairs at midnight.',
  mainCharacter: 'Got the last two tickets to the sold-out gig and the queue cheered.',
  threeWords: 'loud, broke, thriving',
  secretAward: 'Best Group Chat Lurker',
})
async function post(path, body) {
  const r = await fetch(SITE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${path} → ${r.status} ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

async function payOnStripe(page, shot) {
  await page.waitForURL(/checkout\.stripe\.com|buy\.stripe\.com/, { timeout: 30_000 })
  await page.locator('#email').waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.locator('#email').fill('stripe-test@example.com')
  // With several payment methods, the card fields only show once "Card" is picked.
  await page.waitForLoadState('networkidle').catch(() => {})
  const cardNumber = page.locator('#cardNumber')
  for (let i = 0; i < 5 && !(await cardNumber.isVisible().catch(() => false)); i++) {
    // The accordion button is a zero-size overlay, so Playwright can't click it like a user would.
    await page.locator('[data-testid="card-accordion-item-button"]').evaluate((e) => e.click()).catch(() => {})
    await page.waitForTimeout(1500)
  }
  await cardNumber.fill('4242424242424242')
  await page.locator('#cardExpiry').fill('12 / 34')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Stripe Test')
  const zip = page.locator('#billingPostalCode')
  if (await zip.isVisible().catch(() => false)) await zip.fill('94107')
  // Stripe Link "save my info" would ask for a phone number; leave it unticked.
  const link = page.locator('#enableStripePass')
  if (await link.isChecked().catch(() => false)) await link.evaluate((e) => e.click())
  await shot('2-stripe-checkout')
  await page.locator('[data-testid="hosted-payment-submit-button"]').click()
  await page.waitForURL((u) => u.hostname.endsWith('squadwrap.vercel.app'), { timeout: 60_000 })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  const sizes = { desktop: { viewport: { width: 1280, height: 800 } }, mobile: devices['iPhone 13'] }
  const results = {}
  for (const [size, options] of Object.entries(sizes)) {
    const group = await post('/groups', { name: `Stripe test ${size}`, year: 2026, memberCount: 3 })
    for (const name of ['Ana', 'Ben', 'Cat']) await post(`/join/${group.inviteToken}/submissions`, { displayName: name, answers: answers(name), adult: true })
    const context = await browser.newContext(options)
    const page = await context.newPage()
    // Keys in the organizer/invite links are masked in screenshots.
    const shot = (n) => page.screenshot({ path: `${OUT}/payment-${size}-${n}.png`, mask: [page.locator('.copy input, .nudge textarea')] })
    await page.goto(`${SITE}/groups/${group.id}`)
    await page.getByRole('button', { name: 'Make the awards' }).click()
    await page.getByText('Download slide').first().waitFor({ timeout: 120_000 })
    const buy = page.getByRole('link', { name: /Buy the unlock/ })
    await buy.waitFor()
    await buy.scrollIntoViewIfNeeded()
    await shot('1-awards-buy')
    const href = await buy.getAttribute('href')
    if (!href.includes('client_reference_id=' + group.id)) throw new Error('Buy link lacks the group id')
    // The Buy button may open a new tab; follow whichever page lands on Stripe.
    const [maybeNew] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), buy.click()])
    const stripePage = maybeNew || page
    const sshot = (n) => stripePage.screenshot({ path: `${OUT}/payment-${size}-${n}.png` })
    await payOnStripe(stripePage, sshot)
    // The webhook unlocks the group; poll the organizer page.
    let unlocked = false
    for (let i = 0; i < 20 && !unlocked; i++) {
      await page.goto(`${SITE}/groups/${group.id}`)
      unlocked = await page.getByText('Unlocked:').isVisible().catch(() => false)
      if (!unlocked) await page.waitForTimeout(3000)
    }
    await page.getByText(/Unlocked:|watermark/).first().scrollIntoViewIfNeeded().catch(() => {})
    await shot('3-unlocked')
    results[size] = { unlocked }
    console.log(size, unlocked ? 'UNLOCKED after payment' : 'NOT unlocked after 60 s')
    await context.close()
  }
  await browser.close()
  if (Object.values(results).some((r) => !r.unlocked)) throw new Error('a payment did not unlock its group')
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
