import { getDb, getModel, handle } from '../../../../lib/api'
import { generateAwards } from '../../../../lib/squad'

// The model call can take a while on a free tier; the client gives up after 45 s.
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

/** Write one award per submission → { awards }. 422 below 3 submissions, 502 if the model fails. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params
  const awards = await generateAwards(await getDb(), getModel(), id)
  return Response.json({ awards })
})
