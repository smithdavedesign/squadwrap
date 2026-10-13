import { getDb, handle } from '../../../lib/api'
import { handleStripeWebhook } from '../../../lib/payments'

/**
 * Stripe's webhook endpoint (checkout.session.completed and checkout.session.async_payment_succeeded).
 * The signature covers the exact bytes Stripe sent, so the body is read as text and never re-serialized.
 */
export const POST = handle(async (req: Request) => {
  const payload = await req.text()
  const result = await handleStripeWebhook(await getDb(), payload, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)
  return Response.json(result)
})
