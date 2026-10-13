import { createHash } from 'node:crypto'
import Stripe from 'stripe'
import type { Queryable } from './db'
import { UNLOCK_PRICE, deletesOn, formatDay, tooLateToUnlock } from './prompts'
import { AppError, groupNotFound } from './squad'

/** What starting a checkout needs; the Stripe adapter turns it into a Checkout Session. */
export type CheckoutInput = { groupId: string; productName: string; successUrl: string; cancelUrl: string }

/** Anything that can open a payment page: Stripe Checkout, or a stub in tests. */
export interface Payments {
  createCheckout(input: CheckoutInput): Promise<{ url: string }>
}

/** Tags our sessions, for whoever reads a Stripe account that other apps share. */
const APP_TAG = 'squadwrap'

/**
 * Stripe Checkout (hosted page): no card data ever touches this app. `config` only exists so tests can point the
 * SDK at a local fake API; production uses Stripe's defaults and the SDK's pinned API version.
 */
export function createStripePayments(secretKey: string, config: Stripe.StripeConfig = {}): Payments {
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 1, timeout: 20_000, ...config })
  return {
    async createCheckout({ groupId, productName, successUrl, cancelUrl }) {
      // Same group, same request → same key, so for 24 h Stripe hands back the same session instead of a new one:
      // a second click, a second tab or a return with the Back button can't open a second payment. Every parameter
      // goes into the key (Stripe refuses a reused key with different parameters); hashed, so the organizer key
      // isn't spelled out in it.
      const request = [groupId, productName, successUrl, cancelUrl, UNLOCK_PRICE.cents, UNLOCK_PRICE.currency]
      const idempotencyKey = `squadwrap-unlock-${createHash('sha256').update(JSON.stringify(request)).digest('base64url')}`
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: UNLOCK_PRICE.currency,
              unit_amount: UNLOCK_PRICE.cents,
              product_data: { name: productName, description: 'Every award slide of this group, without the PREVIEW watermark.' },
            },
          },
        ],
        // The webhook finds the group by this. It is the organizer's key, which Stripe (a payment processor) then holds.
        client_reference_id: groupId,
        // The webhook trusts sessions with this tag. A Payment Link URL can set client_reference_id, but not this, so
        // untagged (Payment Link) sessions must also have paid the full price (soldTheUnlock).
        metadata: { app: APP_TAG },
        success_url: successUrl,
        cancel_url: cancelUrl,
      }, { idempotencyKey })
      // The organizer's browser is sent straight to this URL, so it must be a web page, never another scheme.
      if (!session.url?.startsWith('https://')) throw new Error('Stripe returned a Checkout Session without an https URL')
      return { url: session.url }
    },
  }
}

/**
 * Stripe when STRIPE_SECRET_KEY is set (a test-mode key until live payments are decided), otherwise none. The
 * webhook's signing secret must be set too: without it no payment could ever be verified, so none would unlock.
 */
export function paymentsFromEnv(env: Record<string, string | undefined>): Payments | null {
  const key = env.STRIPE_SECRET_KEY?.trim()
  return key && env.STRIPE_WEBHOOK_SECRET?.trim() ? createStripePayments(key) : null
}

/**
 * The Buy link for one group: the Stripe Payment Link in STRIPE_PAYMENT_LINK, with the group attached as
 * `client_reference_id` (a group id is base64url, which Stripe accepts there), so the webhook knows what to unlock.
 * Null, and no Buy button, when the variable is unset or isn't an https URL.
 */
export function paymentLinkFor(groupId: string, env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.STRIPE_PAYMENT_LINK?.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  url.searchParams.set('client_reference_id', groupId)
  return url.href
}

/** An error's kind and code, never its message: Stripe messages can echo the request, URLs with the organizer key included. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error'
  const { code, statusCode } = err as { code?: unknown; statusCode?: unknown }
  return [err.name, code, statusCode].filter((part) => part !== undefined && part !== null).join(' ')
}

/** Opens a Checkout Session for unlocking a group; the organizer's browser is sent to the returned URL. */
export async function startCheckout(db: Queryable, payments: Payments | null, groupId: string, origin: string): Promise<{ url: string }> {
  const { rows } = await db.query<{ name: string; year: number; unlocked_at: Date | null; created_at: Date }>(
    'SELECT name, year, unlocked_at, created_at FROM groups WHERE id = $1',
    [groupId],
  )
  const group = rows[0]
  if (!group) throw groupNotFound()
  if (group.unlocked_at) {
    throw new AppError(409, 'already_unlocked', 'This group is already unlocked: every slide comes without the watermark.')
  }
  if (tooLateToUnlock(group.created_at)) {
    throw new AppError(409, 'deleting_soon', `This group is deleted on ${formatDay(deletesOn(group.created_at))}, too soon to unlock it.`)
  }
  if (!payments) throw new AppError(503, 'payments_not_configured', 'Payments aren’t set up on this server yet.')
  const organizerPage = `${origin}/groups/${encodeURIComponent(groupId)}`
  try {
    return await payments.createCheckout({
      groupId,
      productName: `squadwrap unlock: ${group.name}, ${group.year}`,
      // Back on the organizer page, which waits for the webhook to land.
      successUrl: `${organizerPage}?paid=1`,
      cancelUrl: organizerPage,
    })
  } catch (err) {
    console.warn('Starting a checkout failed:', describeError(err))
    throw new AppError(502, 'payments_unavailable', 'The payment page didn’t open. Try again in a minute.')
  }
}

export type WebhookOutcome = 'unlocked' | 'already_unlocked' | 'awaiting_payment' | 'unknown_group' | 'ignored'

/**
 * The events that can mean "paid", per Stripe's fulfillment guide. A delayed method (a bank debit) completes the
 * session unpaid, then sends async_payment_succeeded once the money arrives.
 */
const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

/**
 * POST /webhooks/stripe: verifies the signature over the raw body, then unlocks the group the session was for.
 * Every verified event gets a 200, even one we don't act on, so Stripe stops retrying it. A bad signature gets a 400
 * and changes nothing. The signed event is trusted as is: our server creates the tagged sessions, and a Payment Link
 * session counts only when it paid the full price (soldTheUnlock).
 */
export async function handleStripeWebhook(
  db: Queryable,
  payload: string,
  signature: string | null,
  secret: string | undefined,
): Promise<{ received: true; outcome: WebhookOutcome }> {
  // Without the secret nothing can be verified. A 5xx makes Stripe retry, so the unlock lands once it's set.
  if (!secret?.trim()) throw new AppError(503, 'webhook_not_configured', 'Stripe webhooks aren’t set up on this server yet.')
  let event: Stripe.Event
  try {
    // Checks the HMAC (timing-safe) and that the signature is less than 5 minutes old, then parses the body.
    event = Stripe.webhooks.constructEvent(payload, signature ?? '', secret.trim())
  } catch {
    throw new AppError(400, 'bad_signature', 'The Stripe signature doesn’t match this request.')
  }
  const outcome = await unlockFor(db, event)
  // The event id finds the delivery in Stripe's dashboard; the group id is the organizer's key and stays out of logs.
  // A paid session of ours that unlocked nothing new (paid twice, or the group is gone) may need a refund: a warning.
  const log = outcome === 'already_unlocked' || outcome === 'unknown_group' ? console.warn : console.info
  log(`Stripe webhook ${event.id} (${event.type}): ${outcome}`)
  return { received: true, outcome }
}

/**
 * A one-time payment that sold the unlock: a session createStripePayments made (tagged), or one from a Payment Link
 * (the Buy button's STRIPE_PAYMENT_LINK, opened with ?client_reference_id=<group id>). A Payment Link can't carry
 * our tag, so it counts only when it charged at least the unlock price in its currency: on a shared Stripe account,
 * a cheaper link opened with a group's id unlocks nothing. Anything else (another app's checkout) is not ours.
 */
function soldTheUnlock(session: Stripe.Checkout.Session): boolean {
  if (session.mode !== 'payment') return false
  if (session.metadata?.app === APP_TAG) return true
  return (
    Boolean(session.payment_link) &&
    session.currency === UNLOCK_PRICE.currency &&
    (session.amount_total ?? 0) >= UNLOCK_PRICE.cents
  )
}

async function unlockFor(db: Queryable, event: Stripe.Event): Promise<WebhookOutcome> {
  if (!PAID_EVENTS.has(event.type)) return 'ignored'
  const session = event.data.object as Stripe.Checkout.Session
  if (!soldTheUnlock(session)) return 'ignored'
  if (session.payment_status === 'unpaid') return 'awaiting_payment'
  const groupId = session.client_reference_id
  if (!groupId) return 'ignored'
  // One atomic statement: a replayed or concurrent delivery finds unlocked_at already set and changes nothing.
  const unlocked = await db.query('UPDATE groups SET unlocked_at = now() WHERE id = $1 AND unlocked_at IS NULL RETURNING id', [
    groupId,
  ])
  if (unlocked.rows.length > 0) return 'unlocked'
  const known = await db.query('SELECT 1 FROM groups WHERE id = $1', [groupId])
  // Unknown: another app's session on a shared Stripe account, or a group already deleted after 30 days.
  return known.rows.length > 0 ? 'already_unlocked' : 'unknown_group'
}
