import { getDb, handle, readJsonObject } from '../../../../lib/api'
import { addSubmissionByInvite } from '../../../../lib/squad'

type Ctx = { params: Promise<{ token: string }> }

/** The friend form posts here with the invite token, so friends never need the organizer's group id. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params
  const body = await readJsonObject(req)
  return Response.json(await addSubmissionByInvite(await getDb(), token, body), { status: 201 })
})
