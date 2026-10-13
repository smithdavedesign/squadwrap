import { getDb, handle } from '../../../../lib/api'
import { getPending } from '../../../../lib/squad'

type Ctx = { params: Promise<{ id: string }> }

/** GET /groups/:id/pending → {memberCount, submitted, pending, answered, inviteUrl, nudge}; 404 for an unknown id. */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params
  return Response.json(await getPending(await getDb(), id, new URL(req.url).origin))
})
