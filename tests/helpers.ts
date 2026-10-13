import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import Stripe from 'stripe'
// Next's own code for what a page's `metadata` becomes in <head>, and for how notFound() becomes a 404.
import { getAccessFallbackHTTPStatus, isHTTPAccessFallbackError } from 'next/dist/client/components/http-access-fallback/http-access-fallback'
import { createMetadataElements } from 'next/dist/lib/metadata/metadata-elements'
import { resolveRobots } from 'next/dist/lib/metadata/resolvers/resolve-basics'
import type { Metadata } from 'next'
import { setDeps } from '../lib/api'
import { createPgliteDb, migrate, type Db } from '../lib/db'
import type { ChatMessage, ChatModel } from '../lib/model'
import type { Payments } from '../lib/payments'
import type { Answers } from '../lib/prompts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: any) => Promise<Response>
type RouteModule = Record<string, Handler | unknown>

// Modules load on first use, so a test file only imports the routes and pages it calls.
const ROUTES: { method: string; pattern: RegExp; keys: string[]; load: () => Promise<RouteModule> }[] = [
  { method: 'POST', pattern: /^\/groups$/, keys: [], load: () => import('../app/groups/route') },
  { method: 'POST', pattern: /^\/groups\/([^/]+)\/submissions$/, keys: ['id'], load: () => import('../app/groups/[id]/submissions/route') },
  { method: 'POST', pattern: /^\/groups\/([^/]+)\/generate$/, keys: ['id'], load: () => import('../app/groups/[id]/generate/route') },
  { method: 'GET', pattern: /^\/groups\/([^/]+)\/awards$/, keys: ['id'], load: () => import('../app/groups/[id]/awards/route') },
  { method: 'GET', pattern: /^\/groups\/([^/]+)\/awards\/([^/]+)$/, keys: ['id', 'file'], load: () => import('../app/groups/[id]/awards/[file]/route') },
  { method: 'GET', pattern: /^\/groups\/([^/]+)\/pending$/, keys: ['id'], load: () => import('../app/groups/[id]/pending/route') },
  { method: 'POST', pattern: /^\/groups\/([^/]+)\/checkout$/, keys: ['id'], load: () => import('../app/groups/[id]/checkout/route') },
  { method: 'POST', pattern: /^\/join\/([^/]+)\/submissions$/, keys: ['token'], load: () => import('../app/join/[token]/submissions/route') },
  // Static segments win over dynamic ones in Next.js, so `reports` comes before `[file]`.
  { method: 'POST', pattern: /^\/y\/([^/]+)\/reports$/, keys: ['token'], load: () => import('../app/y/[token]/reports/route') },
  { method: 'GET', pattern: /^\/y\/([^/]+)\/([^/]+)$/, keys: ['token', 'file'], load: () => import('../app/y/[token]/[file]/route') },
  { method: 'POST', pattern: /^\/webhooks\/stripe$/, keys: [], load: () => import('../app/webhooks/stripe/route') },
  { method: 'GET', pattern: /^\/cron\/cleanup$/, keys: [], load: () => import('../app/cron/cleanup/route') },
]

type PageProps = { params: Promise<any>; searchParams: Promise<Record<string, string>> } // eslint-disable-line @typescript-eslint/no-explicit-any
type PageModule = { default: (props: PageProps) => ReactNode | Promise<ReactNode>; metadata?: Metadata }

const PAGES: { pattern: RegExp; keys: string[]; load: () => Promise<PageModule> }[] = [
  { pattern: /^\/$/, keys: [], load: () => import('../app/page') },
  { pattern: /^\/groups\/([^/]+)$/, keys: ['id'], load: () => import('../app/groups/[id]/page') },
  { pattern: /^\/join\/([^/]+)$/, keys: ['token'], load: () => import('../app/join/[token]/page') },
  { pattern: /^\/y\/([^/]+)$/, keys: ['token'], load: () => import('../app/y/[token]/page') },
  { pattern: /^\/y\/([^/]+)\/report$/, keys: ['token'], load: () => import('../app/y/[token]/report/page') },
  { pattern: /^\/privacy$/, keys: [], load: () => import('../app/privacy/page') },
  { pattern: /^\/terms$/, keys: [], load: () => import('../app/terms/page') },
]

/** The raw path is matched first, then each segment is URL-decoded (as Next.js does). */
function matchPath<T extends { pattern: RegExp; keys: string[] }>(table: T[], pathname: string, accept: (entry: T) => boolean = () => true) {
  for (const entry of table) {
    const match = accept(entry) ? pathname.match(entry.pattern) : null
    if (match) return { entry, params: Object.fromEntries(entry.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])) }
  }
  return null
}

export type ApiResult = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Calls the real Next.js route handler for `METHOD /path`, the way the HTTP server would. */
export async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const url = new URL(path, 'http://localhost:3000')
  const found = matchPath(ROUTES, url.pathname, (route) => route.method === method)
  if (!found) throw new Error(`no route for ${method} ${path}`)
  const handler = (await found.entry.load())[method] as Handler
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...headers } }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  return handler(new Request(url, init), { params: Promise.resolve(found.params) })
}

export type PageResult = { status: number; html: string; head: string }

/**
 * Renders the real page for `GET /path` as Next.js would: notFound() → 404; otherwise the page's element tree
 * as HTML, and its `metadata` as the <head> tags Next.js derives from it (Next's own resolver and renderer).
 * Pages with client components that need the app router (the organizer page) need `next/navigation` mocked.
 */
export async function getPage(path: string): Promise<PageResult> {
  const url = new URL(path, 'http://localhost:3000')
  const found = matchPath(PAGES, url.pathname)
  if (!found) throw new Error(`no page for ${path}`)
  const page = await found.entry.load()
  let element: ReactNode
  try {
    element = await page.default({
      params: Promise.resolve(found.params),
      searchParams: Promise.resolve(Object.fromEntries(url.searchParams)),
    })
  } catch (err) {
    if (isHTTPAccessFallbackError(err)) return { status: getAccessFallbackHTTPStatus(err), html: '', head: '' }
    throw err
  }
  const resolved = { robots: resolveRobots(page.metadata?.robots ?? null) }
  const head = renderToStaticMarkup(createElement(Fragment, null, createMetadataElements(resolved as never)))
  return { status: 200, html: renderToStaticMarkup(element), head }
}

/** Every href in a piece of HTML, entity-decoded. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'))
}

/** Like `request`, with the JSON body parsed. */
export async function api(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await request(method, path, body)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

export type BinaryResult = { status: number; headers: Headers; bytes: Buffer }

/** GET a binary resource (a slide PNG) through the real route handler. */
export async function getBinary(path: string, headers: Record<string, string> = {}): Promise<BinaryResult> {
  const res = await request('GET', path, undefined, headers)
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) }
}

export const slideUrl = (groupId: string, displayName: string) =>
  `/groups/${groupId}/awards/${encodeURIComponent(displayName)}.png`

/**
 * A photo-like test image, made at runtime: Gaussian noise compresses about as badly as a real photo.
 * Returns a data URL like the friend form sends.
 */
export async function photoDataUrl(
  { width = 640, height = 480, format = 'jpeg' }: { width?: number; height?: number; format?: 'jpeg' | 'png' | 'webp' } = {},
): Promise<string> {
  const noise = sharp({
    create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  })
  const bytes = await noise.toFormat(format).toBuffer()
  return `data:image/${format};base64,${bytes.toString('base64')}`
}

/** Unlocks a group the way the payment webhook does (M4), by stamping `unlocked_at`, without going through Stripe. */
export async function setUnlocked(db: Db, groupId: string, unlocked = true): Promise<void> {
  await db.query(`UPDATE groups SET unlocked_at = ${unlocked ? 'now()' : 'NULL'} WHERE id = $1`, [groupId])
}

export async function storedPhoto(db: Db, groupId: string, displayName: string): Promise<Buffer | null> {
  const { rows } = await db.query<{ photo: Uint8Array | null }>(
    'SELECT photo FROM submissions WHERE group_id = $1 AND display_name = $2',
    [groupId, displayName],
  )
  if (rows.length === 0) throw new Error(`no submission by ${displayName}`)
  return rows[0].photo ? Buffer.from(rows[0].photo) : null
}

/** A fresh in-memory Postgres (PGlite) with the app schema. */
export async function testDb(): Promise<Db> {
  const db = await createPgliteDb()
  await migrate(db)
  return db
}

export type StubModel = ChatModel & { calls: ChatMessage[][] }

/** A model stand-in that returns raw text (or throws), recording what it was sent. */
export function stubModel(reply: string | ((messages: ChatMessage[]) => string | Promise<string>)): StubModel {
  const calls: ChatMessage[][] = []
  return {
    calls,
    async complete(messages) {
      calls.push(messages)
      return typeof reply === 'function' ? reply(messages) : reply
    },
  }
}

/** Well-formed model output: one award per name, `names` in submission order (ids are 1-indexed positions). */
export function awardsJson(names: string[], titlePrefix = 'The'): string {
  return JSON.stringify({
    awards: names.map((name, i) => ({
      id: i + 1,
      name,
      title: `${titlePrefix} ${name} Award`,
      citation: `For ${name}, who made the year. Nobody will forget it.`,
    })),
  })
}

export function answersFor(name: string): Answers {
  return {
    cancels: `${name} says Jo, every time, "my cat is sad"`,
    lore: `${name} remembers the karaoke night that ended at a 24h laundromat`,
    mainCharacter: `${name} ran for the last train in heels and made it`,
    threeWords: `chaotic, loud, loyal`,
    secretAward: `${name} deserves Best Group Chat Lurker`,
  }
}

/** Payments default to "not configured", so a test can never reach Stripe, whatever the shell's environment holds. */
export function useDeps(db: Db, model: ChatModel | null, payments: Payments | null = null): void {
  setDeps({ db, model, payments })
}

export async function createGroup(name = 'Flat 4B', extra: Record<string, unknown> = {}) {
  const res = await api('POST', '/groups', { name, ...extra })
  if (res.status !== 201) throw new Error(`createGroup failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body as {
    id: string
    name: string
    year: number
    memberCount: number | null
    inviteToken: string
    inviteUrl: string
    yearbookToken: string
    yearbookUrl: string
  }
}

/** A submission as the friend form sends it, with the adults-only box ticked (M4). */
export function submissionBody(displayName: string, answers: unknown = answersFor(displayName), photo?: unknown) {
  return { displayName, answers, photo, adult: true }
}

export function submit(groupId: string, displayName: string, answers: unknown = answersFor(displayName), photo?: unknown) {
  return api('POST', `/groups/${groupId}/submissions`, submissionBody(displayName, answers, photo))
}

/**
 * A group with one submission per name (in order) and generated awards, using `db` and a stub model.
 * `photos` maps a name to a photo data URL.
 */
export async function groupWithAwards(
  db: Db,
  names: string[],
  photos: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  useDeps(db, stubModel(awardsJson(names)))
  const group = await createGroup('Flat 4B', extra)
  for (const name of names) {
    const res = await submit(group.id, name, answersFor(name), photos[name])
    if (res.status !== 201) throw new Error(`submit ${name} failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const res = await api('POST', `/groups/${group.id}/generate`)
  if (res.status !== 200) throw new Error(`generate failed: ${res.status} ${JSON.stringify(res.body)}`)
  return group
}

/**
 * A stand-in for a secret (webhook signing secret, cron secret, API key), built at runtime from a prefix and a
 * filler so that nothing shaped like a credential is ever written into the repo.
 */
export function fakeSecret(prefix: string): string {
  return [prefix, 'squadwrapTest'.repeat(3)].join('_')
}

let eventCounter = 0

/** A Stripe event for a Checkout Session, as Stripe sends it (JSON text): a paid $12 session unless overridden. */
export function checkoutEvent(type: string, session: Record<string, unknown>): string {
  eventCounter += 1
  return JSON.stringify({
    id: `evt_test_${eventCounter}`,
    object: 'event',
    api_version: '2026-09-30.endive',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: {
      object: {
        id: `cs_test_${eventCounter}`,
        object: 'checkout.session',
        mode: 'payment',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 1200,
        currency: 'usd',
        metadata: { app: 'squadwrap' },
        ...session,
      },
    },
  })
}

/** The Stripe-Signature header Stripe would send for `payload`, computed by the Stripe SDK itself. */
export function stripeSignature(payload: string, secret: string, timestamp?: number): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp })
}

/** POST /webhooks/stripe with a raw body and, when given, a Stripe-Signature header. */
export function postWebhook(payload: string, signature?: string): Promise<Response> {
  return request('POST', '/webhooks/stripe', payload, signature === undefined ? {} : { 'stripe-signature': signature })
}

export async function unlockedAt(db: Db, groupId: string): Promise<Date | null> {
  const { rows } = await db.query<{ unlocked_at: Date | null }>('SELECT unlocked_at FROM groups WHERE id = $1', [groupId])
  if (rows.length === 0) throw new Error('no such group')
  return rows[0].unlocked_at
}

/** Moves a group's creation time into the past, as if it had been made `days` ago. */
export async function makeOlder(db: Db, groupId: string, days: number, extraHours = 0): Promise<void> {
  await db.query('UPDATE groups SET created_at = now() - make_interval(days => $2, hours => $3) WHERE id = $1', [
    groupId,
    days,
    extraHours,
  ])
}

/** What a group holds: submissions, photos among them, awards and reports. */
export async function contentsOf(db: Db, groupId: string) {
  const { rows } = await db.query<{ groups: number; submissions: number; photos: number; awards: number; reports: number }>(
    `SELECT (SELECT count(*)::int FROM groups WHERE id = $1) AS groups,
            (SELECT count(*)::int FROM submissions WHERE group_id = $1) AS submissions,
            (SELECT count(*)::int FROM submissions WHERE group_id = $1 AND photo IS NOT NULL) AS photos,
            (SELECT count(*)::int FROM awards WHERE group_id = $1) AS awards,
            (SELECT count(*)::int FROM reports WHERE group_id = $1) AS reports`,
    [groupId],
  )
  return rows[0]
}

export async function countAwards(db: Db, groupId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM awards WHERE group_id = $1', [groupId])
  return rows[0].n
}
