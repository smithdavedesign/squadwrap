import { createHash, timingSafeEqual } from 'node:crypto'
import type { Queryable } from './db'
import { LIMITS } from './prompts'
import { AppError } from './squad'

/**
 * The 30-day deletion job: deletes every group whose deletion day (the UTC day `retentionDays` after it was made,
 * the date its pages show, see deletesOn) has come. ON DELETE CASCADE takes its submissions (photos are stored in
 * them), awards and reports along, and every link to it then answers 404. "Has come" rather than "is today", so a
 * day the job didn't run is caught up on the next.
 */
export async function deleteExpiredGroups(db: Queryable, retentionDays: number = LIMITS.retentionDays): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `WITH gone AS (
       DELETE FROM groups WHERE (created_at AT TIME ZONE 'UTC')::date + $1::int <= (now() AT TIME ZONE 'UTC')::date RETURNING 1
     )
     SELECT count(*)::int AS n FROM gone`,
    [retentionDays],
  )
  return rows[0].n
}

const digest = (text: string) => createHash('sha256').update(text).digest()

/**
 * Only Vercel Cron may start the job: it sends `Authorization: Bearer $CRON_SECRET`. Without a configured secret
 * the job refuses to run at all rather than run for anyone. Digests have equal length, so the compare is timing-safe.
 */
export function assertCronRequest(authorization: string | null, secret: string | undefined): void {
  const expected = secret?.trim()
  if (!expected) throw new AppError(503, 'cron_not_configured', 'CRON_SECRET is not set, so the cleanup job does not run.')
  if (!timingSafeEqual(digest((authorization ?? '').trim()), digest(`Bearer ${expected}`))) {
    throw new AppError(401, 'unauthorized', 'Only the scheduled job may run this.')
  }
}
