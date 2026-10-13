import { getDb, handle, readJsonObject } from '../../../../lib/api'
import { addSubmission } from '../../../../lib/squad'

type Ctx = { params: Promise<{ id: string }> }

/** Add one friend's answers to a group by its id → 201, or 409 for a reused name. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params
  const body = await readJsonObject(req)
  return Response.json(await addSubmission(await getDb(), id, body), { status: 201 })
})
