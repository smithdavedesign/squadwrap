import { getDb, handle, readJsonObject } from '../../../../lib/api'
import { addReport } from '../../../../lib/squad'

type Ctx = { params: Promise<{ token: string }> }

/** POST /y/:token/reports {reason, contact?} → 201 {received: true}. The report form on /y/:token/report posts here. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params
  const body = await readJsonObject(req)
  return Response.json(await addReport(await getDb(), token, body), { status: 201 })
})
