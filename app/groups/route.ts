import { getDb, handle, readJsonObject } from '../../lib/api'
import { createGroup } from '../../lib/squad'

/** Create a group → { id, inviteToken, inviteUrl, dashboardUrl, … }. */
export const POST = handle(async (req: Request) => {
  const body = await readJsonObject(req)
  const group = await createGroup(await getDb(), body, new URL(req.url).origin)
  return Response.json(group, { status: 201 })
})
