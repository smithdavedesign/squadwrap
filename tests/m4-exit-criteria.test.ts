// One test (or more) per M4 exit criterion in ROADMAP.md.
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../lib/db'
import { WATERMARK_HEADER, WATERMARK_KEYWORD } from '../lib/slide'
import {
  api,
  checkoutEvent,
  contentsOf,
  createGroup,
  fakeSecret,
  getBinary,
  getPage,
  groupWithAwards,
  makeOlder,
  photoDataUrl,
  postWebhook,
  request,
  stripeSignature,
  stubModel,
  submissionBody,
  testDb,
  unlockedAt,
  useDeps,
} from './helpers'

// Pages call connection() ("render per request"), which only works inside a Next.js request; notFound() stays real.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))

const WEBHOOK_SECRET = fakeSecret('whsec')
const CRON_SECRET = fakeSecret('cron')

let db: Db
beforeAll(async () => {
  db = await testDb()
})
beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET)
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

/** The watermark as a downloaded slide carries it: the response header and the PNG text chunk. */
async function slideWatermark(yearbookToken: string, name: string) {
  const slide = await getBinary(`/y/${yearbookToken}/${name}.png`)
  expect(slide.status).toBe(200)
  const chunks = Object.fromEntries(((await sharp(slide.bytes).metadata()).comments ?? []).map((c) => [c.keyword, c.text]))
  return { header: slide.headers.get(WATERMARK_HEADER), flag: chunks[WATERMARK_KEYWORD] ?? null }
}

describe('M4 exit criteria', () => {
  it('EC1: a completed checkout.session webhook sets the group to unlocked', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect(await unlockedAt(db, group.id)).toBeNull()
    expect(await slideWatermark(group.yearbookToken, 'Ana')).toEqual({ header: 'preview', flag: 'preview' })

    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: group.id })
    const res = await postWebhook(payload, stripeSignature(payload, WEBHOOK_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, outcome: 'unlocked' })
    expect(await unlockedAt(db, group.id)).toBeInstanceOf(Date)
    // Unlocked is what was paid for: the slides lose the watermark.
    expect(await slideWatermark(group.yearbookToken, 'Ana')).toEqual({ header: null, flag: null })
  })

  it('EC1: replaying the completed checkout.session webhook is idempotent', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const bystander = await groupWithAwards(db, ['Dan', 'Eve', 'Fay'])
    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: group.id })
    const signature = stripeSignature(payload, WEBHOOK_SECRET)
    expect((await postWebhook(payload, signature)).status).toBe(200)
    const unlocked = await unlockedAt(db, group.id)
    expect(unlocked).toBeInstanceOf(Date)

    // The very same delivery again, and a retry as Stripe sends it: the same body, signed again later.
    const retry = stripeSignature(payload, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) + 5)
    for (const header of [signature, retry]) {
      const res = await postWebhook(payload, header)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ received: true, outcome: 'already_unlocked' })
    }
    expect(await unlockedAt(db, group.id)).toEqual(unlocked)
    expect(await unlockedAt(db, bystander.id)).toBeNull()
    expect(await slideWatermark(group.yearbookToken, 'Ben')).toEqual({ header: null, flag: null })
  })

  it('EC2: a webhook with a bad signature returns 400 and does not unlock', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: group.id })
    // Correctly formed, but signed with a secret that isn't ours.
    const res = await postWebhook(payload, stripeSignature(payload, fakeSecret('whsec_other')))

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('bad_signature')
    expect(await unlockedAt(db, group.id)).toBeNull()
    expect(await slideWatermark(group.yearbookToken, 'Ana')).toEqual({ header: 'preview', flag: 'preview' })
  })

  it('EC3: the cleanup job deletes the submissions and photos of a group created 31 days ago and leaves a 29-day-old group untouched', async () => {
    const photo = await photoDataUrl({ width: 48, height: 48 })
    const old = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: photo, Ben: photo })
    const recent = await groupWithAwards(db, ['Dan', 'Eve', 'Fay'], { Dan: photo, Eve: photo })
    for (const group of [old, recent]) {
      expect((await api('POST', `/y/${group.yearbookToken}/reports`, { reason: 'Take my photo down', contact: 'me@example.com' })).status).toBe(201)
    }
    await makeOlder(db, old.id, 31)
    await makeOlder(db, recent.id, 29)
    const before = await contentsOf(db, recent.id)
    expect(before).toEqual({ groups: 1, submissions: 3, photos: 2, awards: 3, reports: 1 })

    const res = await request('GET', '/cron/cleanup', undefined, { authorization: `Bearer ${CRON_SECRET}` })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deletedGroups: 1 })

    // The old group: submissions and photos gone, and with them its awards, reports and every link.
    expect(await contentsOf(db, old.id)).toEqual({ groups: 0, submissions: 0, photos: 0, awards: 0, reports: 0 })
    expect((await getPage(`/y/${old.yearbookToken}`)).status).toBe(404)
    expect((await getBinary(`/y/${old.yearbookToken}/Ana.jpg`)).status).toBe(404)
    expect((await api('GET', `/groups/${old.id}/awards`)).status).toBe(404)

    // The 29-day-old group: exactly as it was.
    expect(await contentsOf(db, recent.id)).toEqual(before)
    expect((await getBinary(`/y/${recent.yearbookToken}/Dan.jpg`)).status).toBe(200)
    expect((await getPage(`/y/${recent.yearbookToken}`)).status).toBe(200)
  })

  it('EC4: submitting without the adults-only checkbox returns 400', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()
    const { adult, ...unticked } = submissionBody('Ana')
    expect(adult).toBe(true)

    for (const path of [`/groups/${group.id}/submissions`, `/join/${group.inviteToken}/submissions`]) {
      const res = await api('POST', path, unticked)
      expect(res.status, path).toBe(400)
      expect(res.body.error.code).toBe('adults_only')
    }
    expect((await contentsOf(db, group.id)).submissions).toBe(0)

    // The same answers with the box ticked are accepted.
    expect((await api('POST', `/join/${group.inviteToken}/submissions`, submissionBody('Ana'))).status).toBe(201)
  })
})
