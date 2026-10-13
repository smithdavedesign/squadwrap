import { getDb, getPayments, handle } from '../../../../lib/api'
import { startCheckout } from '../../../../lib/payments'

type Ctx = { params: Promise<{ id: string }> }

/** Start paying to unlock the group → { url } of a Stripe Checkout page. 409 once unlocked, 503 without Stripe. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params
  return Response.json(await startCheckout(await getDb(), getPayments(), id, new URL(req.url).origin))
})
