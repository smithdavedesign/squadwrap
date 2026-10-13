// Payment (M4) beyond the exit criteria: starting a checkout, the Stripe adapter, every webhook path, and the
// organizer page's unlock states.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../lib/db'
import { createStripePayments, paymentsFromEnv, type CheckoutInput, type Payments } from '../lib/payments'
import { LIMITS, UNLOCK_PRICE } from '../lib/prompts'
import {
  api,
  checkoutEvent,
  createGroup,
  fakeSecret,
  getPage,
  groupWithAwards,
  makeOlder,
  postWebhook,
  setUnlocked,
  stripeSignature,
  stubModel,
  submit,
  testDb,
  unlockedAt,
  useDeps,
} from './helpers'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}))

const WEBHOOK_SECRET = fakeSecret('whsec')
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_stub'

let db: Db
beforeAll(async () => {
  db = await testDb()
})
beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

type StubPayments = Payments & { calls: CheckoutInput[] }

function stubPayments(result: () => Promise<{ url: string }> = async () => ({ url: CHECKOUT_URL })): StubPayments {
  const calls: CheckoutInput[] = []
  return {
    calls,
    async createCheckout(input) {
      calls.push(input)
      return result()
    },
  }
}

async function signedWebhook(type: string, session: Record<string, unknown>) {
  const payload = checkoutEvent(type, session)
  const res = await postWebhook(payload, stripeSignature(payload, WEBHOOK_SECRET))
  return { status: res.status, body: await res.json() }
}

describe('POST /groups/:id/checkout', () => {
  it('returns the Checkout URL for the group, with its price and the organizer page as the way back', async () => {
    const payments = stubPayments()
    useDeps(db, stubModel('{}'), payments)
    const group = await createGroup('Flat 4B', { year: 2026 })

    const res = await api('POST', `/groups/${group.id}/checkout`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: CHECKOUT_URL })
    expect(payments.calls).toEqual([
      {
        groupId: group.id,
        productName: 'squadwrap unlock: Flat 4B, 2026',
        successUrl: `http://localhost:3000/groups/${group.id}?paid=1`,
        cancelUrl: `http://localhost:3000/groups/${group.id}`,
      },
    ])
    // Starting a checkout pays for nothing: only the webhook unlocks.
    expect(await unlockedAt(db, group.id)).toBeNull()
  })

  it('returns 404 for an unknown id, and for the invite or yearbook token used as an id, without calling Stripe', async () => {
    const payments = stubPayments()
    useDeps(db, stubModel('{}'), payments)
    const group = await createGroup()
    for (const id of ['no-such-group-000000000', group.inviteToken, group.yearbookToken]) {
      const res = await api('POST', `/groups/${id}/checkout`)
      expect(res.status, id).toBe(404)
      expect(res.body.error.code).toBe('group_not_found')
    }
    expect(payments.calls).toEqual([])
  })

  it('returns 409 once the group is unlocked, so nobody pays twice in a row', async () => {
    const payments = stubPayments()
    useDeps(db, stubModel('{}'), payments)
    const group = await createGroup()
    await setUnlocked(db, group.id)
    const res = await api('POST', `/groups/${group.id}/checkout`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('already_unlocked')
    expect(payments.calls).toEqual([])
  })

  it(`refuses an unlock in the group's last ${LIMITS.unlockCutoffDays} days (409 deleting_soon): it would be deleted almost at once`, async () => {
    const payments = stubPayments()
    useDeps(db, stubModel('{}'), payments)
    const late = await createGroup()
    const fine = await createGroup()
    await makeOlder(db, late.id, LIMITS.retentionDays - LIMITS.unlockCutoffDays + 1)
    await makeOlder(db, fine.id, LIMITS.retentionDays - LIMITS.unlockCutoffDays - 1)

    const res = await api('POST', `/groups/${late.id}/checkout`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('deleting_soon')
    expect((await api('POST', `/groups/${fine.id}/checkout`)).status).toBe(200)
    expect(payments.calls.map((c) => c.groupId)).toEqual([fine.id])
  })

  it('returns 503 when payments are not configured', async () => {
    useDeps(db, stubModel('{}'), null)
    const group = await createGroup()
    const res = await api('POST', `/groups/${group.id}/checkout`)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('payments_not_configured')
  })

  it('returns 502 when Stripe fails, and logs no organizer key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useDeps(db, stubModel('{}'), stubPayments(() => Promise.reject(new Error('connect ETIMEDOUT'))))
    const group = await createGroup()
    const res = await api('POST', `/groups/${group.id}/checkout`)
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('payments_unavailable')
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain(group.id)
  })
})

/** A local stand-in for api.stripe.com that records what the real SDK sends and answers with `reply`. */
async function fakeStripeApi(reply: { status: number; body: unknown }) {
  const seen: { method?: string; path?: string; authorization?: string; idempotencyKey?: string; params: URLSearchParams }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      seen.push({
        method: req.method,
        path: req.url,
        authorization: req.headers.authorization,
        idempotencyKey: req.headers['idempotency-key'] as string | undefined,
        params: new URLSearchParams(body),
      })
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { seen, port, close: () => new Promise((resolve) => server.close(resolve)) }
}

describe('the Stripe adapter (the real SDK against a local fake API)', () => {
  const key = fakeSecret('sk_test')
  const input: CheckoutInput = {
    groupId: 'group-id-123',
    productName: 'squadwrap unlock: Flat 4B, 2026',
    successUrl: 'http://localhost:3000/groups/group-id-123?paid=1',
    cancelUrl: 'http://localhost:3000/groups/group-id-123',
  }

  it('creates a one-time Checkout Session for the unlock price, tagged with the group', async () => {
    const api = await fakeStripeApi({ status: 200, body: { id: 'cs_test_fake', object: 'checkout.session', url: CHECKOUT_URL } })
    try {
      const payments = createStripePayments(key, { host: '127.0.0.1', port: api.port, protocol: 'http' })
      expect(await payments.createCheckout(input)).toEqual({ url: CHECKOUT_URL })

      expect(api.seen).toHaveLength(1)
      const [call] = api.seen
      expect(call.method).toBe('POST')
      expect(call.path).toBe('/v1/checkout/sessions')
      expect(call.authorization === `Bearer ${key}`).toBe(true)
      expect(Object.fromEntries(call.params)).toMatchObject({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': UNLOCK_PRICE.currency,
        'line_items[0][price_data][unit_amount]': String(UNLOCK_PRICE.cents),
        'line_items[0][price_data][product_data][name]': 'squadwrap unlock: Flat 4B, 2026',
        client_reference_id: 'group-id-123',
        'metadata[app]': 'squadwrap',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      })
    } finally {
      await api.close()
    }
  })

  it('sends the same idempotency key for the same group and checkout, so a second click reuses the session instead of charging twice', async () => {
    const api = await fakeStripeApi({ status: 200, body: { id: 'cs_test_fake', object: 'checkout.session', url: CHECKOUT_URL } })
    try {
      const payments = createStripePayments(key, { host: '127.0.0.1', port: api.port, protocol: 'http' })
      await payments.createCheckout(input)
      await payments.createCheckout(input)
      await payments.createCheckout({ ...input, groupId: 'another-group-456' })
      const [first, second, other] = api.seen.map((call) => call.idempotencyKey)
      expect(first).toMatch(/^squadwrap-unlock-[\w-]{20,}$/)
      expect(second).toBe(first)
      expect(other).not.toBe(first)
      // Derived from the group id, not the id itself (that is the organizer's key).
      expect(first).not.toContain(input.groupId)
    } finally {
      await api.close()
    }
  })

  it('rejects when Stripe answers with an error, without a URL, or with a URL that is not https', async () => {
    const fakes = [
      await fakeStripeApi({ status: 400, body: { error: { type: 'invalid_request_error', message: 'Nope' } } }),
      await fakeStripeApi({ status: 200, body: { id: 'cs_test_fake', object: 'checkout.session', url: null } }),
      await fakeStripeApi({ status: 200, body: { id: 'cs_test_fake', object: 'checkout.session', url: 'javascript:alert(1)' } }),
    ]
    try {
      for (const fake of fakes) {
        const payments = createStripePayments(key, { host: '127.0.0.1', port: fake.port, protocol: 'http' })
        await expect(payments.createCheckout(input)).rejects.toThrow()
      }
    } finally {
      for (const fake of fakes) await fake.close()
    }
  })

  it('is configured only with both the secret key and the webhook secret: a payment the webhook cannot verify would never unlock', () => {
    const webhookSecret = fakeSecret('whsec')
    expect(paymentsFromEnv({})).toBeNull()
    expect(paymentsFromEnv({ STRIPE_SECRET_KEY: '   ', STRIPE_WEBHOOK_SECRET: webhookSecret })).toBeNull()
    expect(paymentsFromEnv({ STRIPE_SECRET_KEY: key })).toBeNull()
    expect(paymentsFromEnv({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: ' ' })).toBeNull()
    expect(typeof paymentsFromEnv({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: webhookSecret })?.createCheckout).toBe('function')
  })
})

describe('POST /webhooks/stripe', () => {
  it('rejects a tampered body, a missing header, a garbage header and a stale signature with 400, unlocking nothing', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const other = await groupWithAwards(db, ['Dan', 'Eve', 'Fay'])
    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: other.id })
    const tampered = payload.replace(other.id, group.id)
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600
    const forged = checkoutEvent('checkout.session.completed', { client_reference_id: group.id })

    const attempts: [string, string, string | undefined][] = [
      ['tampered body', tampered, stripeSignature(payload, WEBHOOK_SECRET)],
      ['no header', forged, undefined],
      ['garbage header', forged, 'nonsense'],
      ['stale signature (replayed after 10 minutes)', forged, stripeSignature(forged, WEBHOOK_SECRET, tenMinutesAgo)],
    ]
    for (const [label, body, signature] of attempts) {
      const res = await postWebhook(body, signature)
      expect(res.status, label).toBe(400)
      expect((await res.json()).error.code, label).toBe('bad_signature')
    }
    expect(await unlockedAt(db, group.id)).toBeNull()
    expect(await unlockedAt(db, other.id)).toBeNull()
  })

  it('answers 503 and unlocks nothing while the signing secret is not configured (Stripe retries later)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: group.id })
    const res = await postWebhook(payload, stripeSignature(payload, WEBHOOK_SECRET))
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('webhook_not_configured')
    expect(await unlockedAt(db, group.id)).toBeNull()
  })

  it('waits while a delayed payment is unpaid, and unlocks when it succeeds', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const pending = await signedWebhook('checkout.session.completed', { client_reference_id: group.id, payment_status: 'unpaid' })
    expect(pending).toEqual({ status: 200, body: { received: true, outcome: 'awaiting_payment' } })
    expect(await unlockedAt(db, group.id)).toBeNull()

    const paid = await signedWebhook('checkout.session.async_payment_succeeded', { client_reference_id: group.id })
    expect(paid).toEqual({ status: 200, body: { received: true, outcome: 'unlocked' } })
    expect(await unlockedAt(db, group.id)).toBeInstanceOf(Date)
  })

  it('does not unlock when a delayed payment fails', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const failed = await signedWebhook('checkout.session.async_payment_failed', { client_reference_id: group.id, payment_status: 'unpaid' })
    expect(failed).toEqual({ status: 200, body: { received: true, outcome: 'ignored' } })
    expect(await unlockedAt(db, group.id)).toBeNull()
  })

  it('unlocks a session that needed no payment (a 100% promotion code)', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const res = await signedWebhook('checkout.session.completed', { client_reference_id: group.id, payment_status: 'no_payment_required' })
    expect(res.body.outcome).toBe('unlocked')
  })

  it('acknowledges other event types, sessions without a group and unknown groups with 200, changing nothing', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect((await signedWebhook('checkout.session.expired', { client_reference_id: group.id })).body.outcome).toBe('ignored')
    expect((await signedWebhook('payment_intent.succeeded', { client_reference_id: group.id })).body.outcome).toBe('ignored')
    expect((await signedWebhook('checkout.session.completed', { client_reference_id: null })).body.outcome).toBe('ignored')
    // Another app's session on a shared Stripe account, or a group already deleted after 30 days.
    const unknown = await signedWebhook('checkout.session.completed', { client_reference_id: 'not-a-squadwrap-group' })
    expect(unknown).toEqual({ status: 200, body: { received: true, outcome: 'unknown_group' } })
    expect(await unlockedAt(db, group.id)).toBeNull()
  })

  it('ignores a paid session this app did not create (no squadwrap tag, or not a one-time payment), unlocking nothing', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    // E.g. another app's Payment Link on a shared Stripe account, opened with ?client_reference_id=<this group's id>.
    const foreign = [
      { metadata: {} },
      { metadata: null },
      { metadata: { app: 'tiebreak' } },
      { mode: 'subscription' },
      { mode: 'setup', payment_status: 'no_payment_required' },
    ]
    for (const session of foreign) {
      const res = await signedWebhook('checkout.session.completed', { client_reference_id: group.id, ...session })
      expect(res, JSON.stringify(session)).toEqual({ status: 200, body: { received: true, outcome: 'ignored' } })
    }
    expect(await unlockedAt(db, group.id)).toBeNull()
  })

  it('logs a paid session that unlocked nothing as a warning, for the operator to refund', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: 'deleted-group-0000000000' })
    await postWebhook(payload, stripeSignature(payload, WEBHOOK_SECRET))
    expect(JSON.stringify(warn.mock.calls)).toContain(JSON.parse(payload).id)
    expect(JSON.stringify(warn.mock.calls)).toContain('unknown_group')
  })

  it('unlocks exactly once when two deliveries arrive at the same time', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: group.id })
    const signature = stripeSignature(payload, WEBHOOK_SECRET)
    const results = await Promise.all([postWebhook(payload, signature), postWebhook(payload, signature)])
    const outcomes = await Promise.all(results.map(async (r) => (await r.json()).outcome))
    expect(outcomes.sort()).toEqual(['already_unlocked', 'unlocked'])
  })

  it('logs the event id but never the group id (the organizer key)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const payload = checkoutEvent('checkout.session.completed', { client_reference_id: group.id })
    await postWebhook(payload, stripeSignature(payload, WEBHOOK_SECRET))
    const logged = JSON.stringify(info.mock.calls)
    expect(logged).toContain(JSON.parse(payload).id)
    expect(logged).not.toContain(group.id)
  })
})

describe('organizer page: unlocking', () => {
  const unlockButton = /<button[^>]*>Unlock for \$12<\/button>/

  it('offers the unlock once the awards exist, with the price', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).toMatch(unlockButton)
    expect(html).toContain(UNLOCK_PRICE.label)
  })

  it('offers no unlock before there are awards to unlock', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()
    await submit(group.id, 'Ana')
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).not.toMatch(unlockButton)
  })

  it('says the group is unlocked once paid, with no button', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    await setUnlocked(db, group.id)
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).toContain('Unlocked')
    expect(html).not.toMatch(unlockButton)
    expect(html).not.toContain('Payment received')
  })

  it(`offers no unlock in the group's last ${LIMITS.unlockCutoffDays} days, and says why`, async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    await makeOlder(db, group.id, LIMITS.retentionDays - 1)
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).not.toMatch(unlockButton)
    expect(html).toContain('too close to its deletion')
  })

  it('says the payment is being confirmed when back from Checkout before the webhook landed', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const { html } = await getPage(`/groups/${group.id}?paid=1`)
    expect(html).toContain('Payment received')
    expect(html).not.toMatch(unlockButton)
  })
})
