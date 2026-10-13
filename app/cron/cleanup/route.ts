import { getDb, handle } from '../../../lib/api'
import { assertCronRequest, deleteExpiredGroups } from '../../../lib/cleanup'

/** The 30-day deletion job, run daily by Vercel Cron (vercel.json) → { deletedGroups }. 401 for anyone else. */
export const GET = handle(async (req: Request) => {
  assertCronRequest(req.headers.get('authorization'), process.env.CRON_SECRET)
  const deletedGroups = await deleteExpiredGroups(await getDb())
  console.info(`Cleanup: deleted ${deletedGroups} group(s) whose 30 days were up`)
  return Response.json({ deletedGroups })
})
