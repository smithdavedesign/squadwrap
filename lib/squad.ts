import { randomBytes } from 'node:crypto'
import type { Db, Queryable } from './db'
import { ModelOutputError, buildMessages, parseAwards, type Award, type ChatModel } from './model'
import { nudgeText, pendingCount } from './nudge'
import { PhotoError, decodePhotoField, normalizePhoto } from './photo'
import { LIMITS, PROMPTS, cleanLine, deletesOn, nameKey, type Answers } from './prompts'
import type { Slide } from './slide'

/** An error with an HTTP status and a stable code, rendered as JSON by lib/api.ts. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type Body = Record<string, unknown>

export const groupNotFound = () => new AppError(404, 'group_not_found', 'That group link does not exist.')

/** 16 random bytes, base64url: the organizer's group id, the friends' invite token and the yearbook token. */
export const newSecret = () => randomBytes(16).toString('base64url')

function invalid(message: string): never {
  throw new AppError(400, 'invalid_input', message)
}

function requiredText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? cleanLine(value) : ''
  if (!text) invalid(`${field} is required.`)
  if (text.length > max) invalid(`${field} must be at most ${max} characters.`)
  return text
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') invalid(`${field} must be text.`)
  const text = cleanLine(value)
  if (text.length > max) invalid(`${field} must be at most ${max} characters.`)
  return text || null
}

function optionalInt(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(`${field} must be a whole number from ${min} to ${max}.`)
  }
  return value
}

export type CreatedGroup = {
  id: string
  name: string
  year: number
  memberCount: number | null
  inviteToken: string
  inviteUrl: string
  yearbookToken: string
  yearbookUrl: string
  dashboardUrl: string
}

export async function createGroup(db: Queryable, body: Body, origin: string): Promise<CreatedGroup> {
  const name = requiredText(body.name, 'Group name', LIMITS.groupName)
  const year = optionalInt(body.year, 'Year', LIMITS.minYear, LIMITS.maxYear) ?? new Date().getUTCFullYear()
  const memberCount = optionalInt(body.memberCount, 'Member count', LIMITS.minMembers, LIMITS.maxMembers)
  const id = newSecret()
  const inviteToken = newSecret()
  const yearbookToken = newSecret()
  await db.query(
    'INSERT INTO groups (id, invite_token, yearbook_token, name, year, member_count) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, inviteToken, yearbookToken, name, year, memberCount],
  )
  return {
    id,
    name,
    year,
    memberCount,
    inviteToken,
    inviteUrl: `${origin}/join/${inviteToken}`,
    yearbookToken,
    yearbookUrl: `${origin}${yearbookPath(yearbookToken)}`,
    dashboardUrl: `${origin}/groups/${id}`,
  }
}

/** Runs a photo step, turning a PhotoError into a 400 (bad upload) or 503 (no image support) with its message. */
async function photoStep<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step()
  } catch (err) {
    if (err instanceof PhotoError && err.status === 503) throw new AppError(503, 'photos_unavailable', err.message)
    if (err instanceof PhotoError) invalid(err.message)
    throw err
  }
}

/** The friend form's "I'm 18 or older" box. Checked before anything else: nothing in a submission without it is looked at. */
function assertAdult(body: Body): void {
  if (body.adult !== true) {
    throw new AppError(400, 'adults_only', 'squadwrap is for adults only. Tick the box to confirm you’re 18 or older.')
  }
}

async function parseSubmission(body: Body): Promise<{ displayName: string; answers: Answers; upload: Buffer | null }> {
  assertAdult(body)
  const displayName = requiredText(body.displayName, 'Your name', LIMITS.displayName)
  if (!nameKey(displayName)) invalid('Your name needs at least one visible character.')
  const raw = body.answers
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid('Answers are required.')
  const answers = {} as Answers
  for (const prompt of PROMPTS) {
    answers[prompt.id] = requiredText((raw as Body)[prompt.id], `The answer to "${prompt.label}"`, LIMITS.answer)
  }
  // Only the cheap base64 decode here; the image itself is decoded once the group is known to exist.
  const upload = await photoStep(() => decodePhotoField(body.photo))
  return { displayName, answers, upload }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}

const duplicateName = () =>
  new AppError(409, 'duplicate_name', 'Someone in this group already answered with that name. Add an initial?')

/** 409 when the group is full or the name is taken. */
async function assertRoomFor(q: Queryable, groupId: string, key: string): Promise<void> {
  const { rows } = await q.query<{ n: number; taken: boolean }>(
    'SELECT count(*)::int AS n, coalesce(bool_or(name_key = $2), false) AS taken FROM submissions WHERE group_id = $1',
    [groupId, key],
  )
  if (rows[0].n >= LIMITS.maxMembers) {
    throw new AppError(409, 'group_full', `This group already has ${LIMITS.maxMembers} answers.`)
  }
  if (rows[0].taken) throw duplicateName()
}

export async function addSubmission(db: Db, groupId: string, body: Body): Promise<{ displayName: string }> {
  const { displayName, answers, upload } = await parseSubmission(body)
  const key = nameKey(displayName)
  let photo: Buffer | null = null
  if (upload) {
    // Cheap refusals first, so no image is decoded for a submission that can't be stored.
    // The transaction below checks again under the group lock; this pass only saves work.
    if (!(await findGroup(db, groupId))) throw groupNotFound()
    await assertRoomFor(db, groupId, key)
    // Normalized before the transaction, so the group lock is never held while an image is processed.
    photo = await photoStep(() => normalizePhoto(upload))
  }
  return db.tx(async (q) => {
    // Locking the group row serializes submissions per group, so the size cap can't be raced past.
    const group = await q.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId])
    if (group.rows.length === 0) throw groupNotFound()
    await assertRoomFor(q, groupId, key)
    try {
      await q.query(
        'INSERT INTO submissions (group_id, display_name, name_key, answers, photo) VALUES ($1, $2, $3, $4, $5)',
        [groupId, displayName, key, JSON.stringify(answers), photo],
      )
    } catch (err) {
      // The unique index stays the last word on duplicate names.
      if (isUniqueViolation(err)) throw duplicateName()
      throw err
    }
    return { displayName }
  })
}

/** Friends submit through the invite token, so they never see the organizer's group id. */
export async function addSubmissionByInvite(db: Db, inviteToken: string, body: Body): Promise<{ displayName: string }> {
  assertAdult(body)
  const { rows } = await db.query<{ id: string }>('SELECT id FROM groups WHERE invite_token = $1', [inviteToken])
  if (rows.length === 0) throw groupNotFound()
  return addSubmission(db, rows[0].id, body)
}

type GroupRow = {
  id: string
  name: string
  year: number
  member_count: number | null
  invite_token: string
  yearbook_token: string
  unlocked_at: Date | null
  created_at: Date
}
type SubmissionRow = { id: number; display_name: string; answers: Answers; created_at: Date }

const GROUP_COLUMNS = 'id, name, year, member_count, invite_token, yearbook_token, unlocked_at, created_at'

async function findGroup(db: Queryable, groupId: string): Promise<GroupRow | null> {
  const { rows } = await db.query<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM groups WHERE id = $1`, [groupId])
  return rows[0] ?? null
}

/** The group behind a yearbook link. Only the yearbook token opens it, never the group id or the invite token. */
async function findGroupByYearbookToken(db: Queryable, yearbookToken: string): Promise<GroupRow | null> {
  const { rows } = await db.query<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM groups WHERE yearbook_token = $1`, [yearbookToken])
  return rows[0] ?? null
}

async function requireGroup(lookup: Promise<GroupRow | null>): Promise<GroupRow> {
  const group = await lookup
  if (!group) throw groupNotFound()
  return group
}

async function listSubmissions(db: Queryable, groupId: string): Promise<SubmissionRow[]> {
  const { rows } = await db.query<SubmissionRow>(
    'SELECT id, display_name, answers, created_at FROM submissions WHERE group_id = $1 ORDER BY created_at, id',
    [groupId],
  )
  return rows
}

async function listStoredAwards(db: Queryable, groupId: string): Promise<Award[]> {
  const { rows } = await db.query<{ display_name: string; title: string; citation: string }>(
    `SELECT s.display_name, a.title, a.citation
       FROM awards a JOIN submissions s ON s.id = a.submission_id
      WHERE a.group_id = $1
      ORDER BY s.created_at, s.id`,
    [groupId],
  )
  return rows.map((r) => ({ displayName: r.display_name, title: r.title, citation: r.citation }))
}

/** Logs our own error name and message (HTTP status, timeout, shape problem), never answers or keys. */
function logModelFailure(err: unknown): void {
  console.warn('Award generation failed:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error')
}

/**
 * One award per submission, all or nothing: the model reply is fully validated before anything is
 * written, and the old awards are swapped for the new ones in a single transaction.
 * Returns the group's awards as stored afterwards.
 */
export async function generateAwards(db: Db, model: ChatModel | null, groupId: string): Promise<Award[]> {
  const group = await requireGroup(findGroup(db, groupId))
  const submissions = await listSubmissions(db, groupId)
  if (submissions.length < LIMITS.minSubmissionsToGenerate) {
    throw new AppError(
      422,
      'not_enough_submissions',
      `Awards need at least ${LIMITS.minSubmissionsToGenerate} answers; this group has ${submissions.length}.`,
    )
  }
  if (!model) throw new AppError(503, 'model_not_configured', 'No AI model is configured on this server.')

  const people = submissions.map((s) => ({ displayName: s.display_name, answers: s.answers }))
  const badOutput = () => new AppError(502, 'model_bad_output', 'The AI returned something unusable. Try again.')

  // Only failures of the model call itself map to "unavailable"; a bug in our own code stays a 500.
  let reply: string
  try {
    reply = await model.complete(buildMessages(group, people))
  } catch (err) {
    logModelFailure(err)
    if (err instanceof ModelOutputError) throw badOutput()
    throw new AppError(502, 'model_unavailable', 'The AI is not answering right now. Try again in a minute.')
  }
  let awards: Award[]
  try {
    awards = parseAwards(reply, people)
  } catch (err) {
    if (!(err instanceof ModelOutputError)) throw err
    logModelFailure(err)
    throw badOutput()
  }

  const newestSeen = Math.max(...submissions.map((s) => s.id))
  const written = await db.tx(async (q) => {
    // The row lock serializes concurrent generates for the same group. The group can be gone by now: the 30-day
    // cleanup job may have deleted it, submissions included, while the model was writing.
    const locked = await q.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId])
    if (locked.rows.length === 0) throw groupNotFound()
    // A slower generate that started before a friend answered must not replace newer awards that
    // already include that friend. Submission ids only grow, so "newer" means a higher id.
    const newer = await q.query('SELECT 1 FROM awards WHERE group_id = $1 AND submission_id > $2 LIMIT 1', [
      groupId,
      newestSeen,
    ])
    if (newer.rows.length > 0) return false
    await q.query('DELETE FROM awards WHERE group_id = $1', [groupId])
    const params: unknown[] = []
    // parseAwards returns awards in the order of `people`, i.e. of `submissions`.
    const rows = awards.map((award, i) => {
      params.push(submissions[i].id, groupId, award.title, award.citation)
      const n = i * 4
      return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4})`
    })
    await q.query(`INSERT INTO awards (submission_id, group_id, title, citation) VALUES ${rows.join(', ')}`, params)
    return true
  })
  // If a newer generate won, answer with what is stored now rather than our outdated set.
  return written ? awards : listStoredAwards(db, groupId)
}

export async function getAwards(db: Queryable, groupId: string) {
  const group = await requireGroup(findGroup(db, groupId))
  return { group: { id: group.id, name: group.name, year: group.year }, awards: await listStoredAwards(db, groupId) }
}

/** Data for the organizer page, or null when the id is unknown. */
export async function getDashboard(db: Queryable, groupId: string) {
  const group = await findGroup(db, groupId)
  if (!group) return null
  const submissions = await listSubmissions(db, groupId)
  return {
    id: group.id,
    name: group.name,
    year: group.year,
    memberCount: group.member_count,
    pending: pendingCount(group.member_count, submissions.length),
    inviteToken: group.invite_token,
    yearbookToken: group.yearbook_token,
    unlocked: group.unlocked_at !== null,
    createdAt: group.created_at,
    deletesOn: deletesOn(group.created_at),
    submissions: submissions.map((s) => ({ displayName: s.display_name, submittedAt: s.created_at })),
    awards: await listStoredAwards(db, groupId),
  }
}

/**
 * Who still has to answer, for the organizer: the pending count (null without a member count), who answered
 * in order, and a nudge message with the invite link (null when everyone counted has answered).
 */
export async function getPending(db: Queryable, groupId: string, origin: string) {
  const group = await requireGroup(findGroup(db, groupId))
  const answered = (await listSubmissions(db, groupId)).map((s) => s.display_name)
  const inviteUrl = `${origin}/join/${group.invite_token}`
  return {
    memberCount: group.member_count,
    submitted: answered.length,
    pending: pendingCount(group.member_count, answered.length),
    answered,
    inviteUrl,
    nudge: nudgeText({ groupName: group.name, year: group.year, answered, memberCount: group.member_count, inviteUrl }),
  }
}

/**
 * The organizer's URL for a friend's story slide (the M2 API, still served). The name is matched like a duplicate
 * check, ignoring case and spacing. The app's own links use yearbookFilePath, so they never carry the organizer key.
 */
export function slidePath(groupId: string, displayName: string): string {
  return `/groups/${encodeURIComponent(groupId)}/awards/${encodeURIComponent(displayName)}.png`
}

/** The yearbook page, which friends get from the organizer once the awards exist. */
export function yearbookPath(yearbookToken: string): string {
  return `/y/${encodeURIComponent(yearbookToken)}`
}

/** A friend's slide (.png) or photo (.jpg) behind the yearbook link. Names are matched like slidePath's. */
export function yearbookFilePath(yearbookToken: string, displayName: string, ext: 'png' | 'jpg'): string {
  return `${yearbookPath(yearbookToken)}/${encodeURIComponent(displayName)}.${ext}`
}

type AwardRow = { display_name: string; photo: Uint8Array | null; title: string; citation: string }

/** A friend's award and photo, or 404 when that friend has no award in the group. */
async function findAward(db: Queryable, groupId: string, displayName: string): Promise<AwardRow> {
  const { rows } = await db.query<AwardRow>(
    `SELECT s.display_name, s.photo, a.title, a.citation
       FROM submissions s JOIN awards a ON a.submission_id = s.id
      WHERE s.group_id = $1 AND s.name_key = $2`,
    [groupId, nameKey(displayName)],
  )
  if (!rows[0]) throw new AppError(404, 'award_not_found', 'There is no award for that name in this group yet.')
  return rows[0]
}

async function slideOf(db: Queryable, group: GroupRow, displayName: string): Promise<Omit<Slide, 'credit'>> {
  const row = await findAward(db, group.id, displayName)
  return {
    groupName: group.name,
    year: group.year,
    displayName: row.display_name,
    title: row.title,
    citation: row.citation,
    photo: row.photo ? Buffer.from(row.photo) : null,
    watermark: group.unlocked_at === null,
  }
}

/** Everything a slide shows except the credit line, or 404 when the group or that friend's award doesn't exist. */
export async function getSlide(db: Queryable, groupId: string, displayName: string): Promise<Omit<Slide, 'credit'>> {
  return slideOf(db, await requireGroup(findGroup(db, groupId)), displayName)
}

/** The same slide, reached through the yearbook link instead of the organizer's. */
export async function getYearbookSlide(db: Queryable, yearbookToken: string, displayName: string): Promise<Omit<Slide, 'credit'>> {
  return slideOf(db, await requireGroup(findGroupByYearbookToken(db, yearbookToken)), displayName)
}

/** A friend's stored photo (the normalized JPEG from lib/photo.ts) for the yearbook page; only friends with an award. */
export async function getYearbookPhoto(db: Queryable, yearbookToken: string, displayName: string): Promise<Buffer> {
  const group = await requireGroup(findGroupByYearbookToken(db, yearbookToken))
  const row = await findAward(db, group.id, displayName)
  if (!row.photo) throw new AppError(404, 'photo_not_found', 'That friend didn’t add a photo.')
  return Buffer.from(row.photo)
}

export type Yearbook = {
  name: string
  year: number
  unlocked: boolean
  /** When the cleanup job deletes the group, and this page with it. */
  deletesOn: Date
  awards: (Award & { hasPhoto: boolean })[]
}

/** Data for the yearbook page, or null for a wrong token. It never holds the group id or the invite token. */
export async function getYearbook(db: Queryable, yearbookToken: string): Promise<Yearbook | null> {
  const group = await findGroupByYearbookToken(db, yearbookToken)
  if (!group) return null
  const { rows } = await db.query<{ display_name: string; title: string; citation: string; has_photo: boolean }>(
    `SELECT s.display_name, a.title, a.citation, s.photo IS NOT NULL AS has_photo
       FROM awards a JOIN submissions s ON s.id = a.submission_id
      WHERE a.group_id = $1
      ORDER BY s.created_at, s.id`,
    [group.id],
  )
  return {
    name: group.name,
    year: group.year,
    unlocked: group.unlocked_at !== null,
    deletesOn: deletesOn(group.created_at),
    awards: rows.map((r) => ({ displayName: r.display_name, title: r.title, citation: r.citation, hasPhoto: r.has_photo })),
  }
}

/** The group name and year for the report page, or null for a wrong token. */
export async function getYearbookGroup(db: Queryable, yearbookToken: string): Promise<{ name: string; year: number } | null> {
  const group = await findGroupByYearbookToken(db, yearbookToken)
  return group ? { name: group.name, year: group.year } : null
}

/**
 * Stores a report about a yearbook for the operator (BUILD.md, "Handling reports"). At most
 * LIMITS.reportsPerGroupPerHour per group in any rolling hour, counted under the group row lock so concurrent
 * reports can't overshoot.
 */
export async function addReport(db: Db, yearbookToken: string, body: Body): Promise<{ received: true }> {
  const reason = requiredText(body.reason, 'What’s wrong', LIMITS.reportReason)
  const contact = optionalText(body.contact, 'Contact details', LIMITS.reportContact)
  const group = await requireGroup(findGroupByYearbookToken(db, yearbookToken))
  await db.tx(async (q) => {
    const locked = await q.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [group.id])
    if (locked.rows.length === 0) throw groupNotFound()
    const { rows } = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM reports WHERE group_id = $1 AND created_at > now() - interval '1 hour'`,
      [group.id],
    )
    if (rows[0].n >= LIMITS.reportsPerGroupPerHour) {
      throw new AppError(429, 'too_many_reports', 'This yearbook got a lot of reports in the last hour. Please try again in an hour.')
    }
    await q.query('INSERT INTO reports (group_id, reason, contact) VALUES ($1, $2, $3)', [group.id, reason, contact])
  })
  return { received: true }
}

/** Data for the friend page: only what a friend needs, never the organizer's group id. */
export async function getInvite(db: Queryable, inviteToken: string): Promise<{ name: string; year: number } | null> {
  const { rows } = await db.query<{ name: string; year: number }>('SELECT name, year FROM groups WHERE invite_token = $1', [
    inviteToken,
  ])
  return rows[0] ?? null
}
