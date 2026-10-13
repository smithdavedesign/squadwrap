// The 30-day deletion job (M4) beyond the exit criterion: who may run it, its boundary, the Vercel Cron schedule,
// and the deletion date shown to people.
import { readFile } from 'node:fs/promises'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../lib/db'
import { deleteExpiredGroups } from '../lib/cleanup'
import { LIMITS, deletesOn, formatDay } from '../lib/prompts'
import { getDashboard } from '../lib/squad'
import {
  api,
  awardsJson,
  contentsOf,
  createGroup,
  fakeSecret,
  getPage,
  groupWithAwards,
  makeOlder,
  request,
  stubModel,
  submit,
  testDb,
  useDeps,
} from './helpers'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}))

const CRON_SECRET = fakeSecret('cron')

let db: Db
beforeAll(async () => {
  db = await testDb()
})
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  useDeps(db, stubModel('{}'))
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const runJob = (headers: Record<string, string> = { authorization: `Bearer ${CRON_SECRET}` }) =>
  request('GET', '/cron/cleanup', undefined, headers)

async function expiredGroup() {
  const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
  await makeOlder(db, group.id, 31)
  return group
}

describe('GET /cron/cleanup', () => {
  it('refuses a request without the cron secret (401), deleting nothing', async () => {
    const group = await expiredGroup()
    const attempts: Record<string, string>[] = [
      {},
      { authorization: 'Bearer wrong' },
      { authorization: CRON_SECRET },
      { authorization: `Basic ${CRON_SECRET}` },
    ]
    for (const headers of attempts) {
      const res = await runJob(headers)
      expect(res.status).toBe(401)
      expect((await res.json()).error.code).toBe('unauthorized')
    }
    expect((await contentsOf(db, group.id)).groups).toBe(1)
  })

  it('refuses to run while CRON_SECRET is not set (503), deleting nothing', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const group = await expiredGroup()
    const attempts: Record<string, string>[] = [{}, { authorization: 'Bearer ' }]
    for (const headers of attempts) {
      const res = await runJob(headers)
      expect(res.status).toBe(503)
      expect((await res.json()).error.code).toBe('cron_not_configured')
    }
    expect((await contentsOf(db, group.id)).groups).toBe(1)
  })

  it('catches up on every overdue group, and a second run finds nothing left to delete', async () => {
    const groups = [await expiredGroup(), await expiredGroup()]
    await makeOlder(db, groups[1].id, 90)
    const first = await runJob()
    expect(first.status).toBe(200)
    expect((await first.json()).deletedGroups).toBeGreaterThanOrEqual(2)
    for (const group of groups) expect((await contentsOf(db, group.id)).groups).toBe(0)

    const second = await runJob()
    expect(await second.json()).toEqual({ deletedGroups: 0 })
  })
})

/** Sets a group's creation time to today's UTC midnight (as the database sees it) plus the given offset. */
async function madeAt(groupId: string, days: number, minutes = 0): Promise<Date> {
  const { rows } = await db.query<{ created_at: Date }>(
    `UPDATE groups SET created_at = (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => $2, mins => $3)
      WHERE id = $1 RETURNING created_at`,
    [groupId, days, minutes],
  )
  return rows[0].created_at
}

describe('deleteExpiredGroups', () => {
  it('deletes a group on the day people are shown, whatever the hour it was made, and not a day earlier', async () => {
    const today = formatDay(new Date())
    const cases = [
      { label: 'deletion day was yesterday', days: -LIMITS.retentionDays, minutes: -1, deleted: true },
      { label: 'deletion day is today (made at midnight)', days: -LIMITS.retentionDays, minutes: 0, deleted: true },
      { label: 'deletion day is today (made at 23:59)', days: -LIMITS.retentionDays, minutes: 23 * 60 + 59, deleted: true },
      { label: 'deletion day is tomorrow', days: -LIMITS.retentionDays + 1, minutes: 0, deleted: false },
    ]
    const groups = []
    for (const c of cases) {
      const group = await createGroup()
      const created = await madeAt(group.id, c.days, c.minutes)
      // What the organizer page and the yearbook say is exactly when the job deletes it.
      if (c.deleted && c.minutes >= 0) expect(formatDay(deletesOn(created)), c.label).toBe(today)
      groups.push({ ...c, id: group.id })
    }
    await deleteExpiredGroups(db)
    for (const g of groups) expect((await contentsOf(db, g.id)).groups, g.label).toBe(g.deleted ? 0 : 1)
  })

  it('returns how many groups it deleted', async () => {
    await deleteExpiredGroups(db)
    await makeOlder(db, (await createGroup()).id, 45)
    await makeOlder(db, (await createGroup()).id, 31)
    expect(await deleteExpiredGroups(db)).toBe(2)
    expect(await deleteExpiredGroups(db)).toBe(0)
  })
})

describe('deletion during a generate', () => {
  it('answers 404 (not a 500) when the group is deleted while the AI is writing, and stores nothing', async () => {
    const group = await createGroup()
    for (const name of ['Ana', 'Ben', 'Cat']) await submit(group.id, name)
    useDeps(
      db,
      stubModel(async () => {
        // The daily job runs while the model call is in flight.
        await makeOlder(db, group.id, 31)
        await deleteExpiredGroups(db)
        return awardsJson(['Ana', 'Ben', 'Cat'])
      }),
    )
    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('group_not_found')
    expect(await contentsOf(db, group.id)).toEqual({ groups: 0, submissions: 0, photos: 0, awards: 0, reports: 0 })
  })
})

describe('the Vercel Cron schedule (vercel.json)', () => {
  it('runs /cron/cleanup once a day (Vercel Hobby allows no more), and that path is a real route', async () => {
    const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
    const job = config.crons?.find((c: { path: string }) => c.path === '/cron/cleanup')
    expect(job).toBeDefined()
    const [minute, hour, ...rest] = job.schedule.split(' ')
    expect(minute).toMatch(/^\d{1,2}$/)
    expect(hour).toMatch(/^\d{1,2}$/)
    expect(rest).toEqual(['*', '*', '*'])
    expect((await runJob()).status).toBe(200)
  })
})

describe('the deletion date people see', () => {
  it(`is ${LIMITS.retentionDays} days after the group was made, written out in UTC`, () => {
    const made = new Date('2026-11-28T22:30:00Z')
    expect(deletesOn(made).toISOString()).toBe('2026-12-28T22:30:00.000Z')
    expect(formatDay(deletesOn(made))).toBe('December 28, 2026')
  })

  it('is on the organizer page and the yearbook', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const dashboard = await getDashboard(db, group.id)
    const day = formatDay(dashboard!.deletesOn)
    expect(dashboard!.deletesOn.getTime() - dashboard!.createdAt.getTime()).toBe(LIMITS.retentionDays * 86_400_000)
    expect((await getPage(`/groups/${group.id}`)).html).toContain(day)
    expect((await getPage(`/y/${group.yearbookToken}`)).html).toContain(day)
  })
})
