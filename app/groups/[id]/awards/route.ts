import { getDb, handle } from '../../../../lib/api'
import { getAwards } from '../../../../lib/squad'

type Ctx = { params: Promise<{ id: string }> }

/** The group and its stored awards → { group, awards }; 404 for an unknown id. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params
  return Response.json(await getAwards(await getDb(), id))
})
