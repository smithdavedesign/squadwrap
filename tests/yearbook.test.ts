// The yearbook and nudges (M3) beyond the exit criteria: the page, its slides and photos, reports,
// the pending API, the organizer page and the response headers on private links.
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config'
import type { Db } from '../lib/db'
import { LIMITS } from '../lib/prompts'
import { WATERMARK_KEYWORD } from '../lib/slide'
import { getDashboard, getInvite, getYearbook } from '../lib/squad'
import {
  answersFor,
  api,
  awardsJson,
  createGroup,
  getBinary,
  getPage,
  groupWithAwards,
  hrefs,
  photoDataUrl,
  setUnlocked,
  storedPhoto,
  stubModel,
  submissionBody,
  submit,
  testDb,
  useDeps,
} from './helpers'

// Pages call connection() ("render per request"), which only works inside a Next.js request, and the organizer
// page's buttons use the app router. Both are stubbed; notFound() and everything else stay real.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}))

const comments = async (png: Uint8Array) =>
  Object.fromEntries(((await sharp(png).metadata()).comments ?? []).map((c) => [c.keyword, c.text]))

const fileUrl = (token: string, name: string, ext: string) => `/y/${token}/${encodeURIComponent(name)}.${ext}`

let db: Db
beforeAll(async () => {
  db = await testDb()
})

describe('POST /groups (yearbook token)', () => {
  it('gives every group a yearbook token, distinct from its id and invite token, and a yearbook URL', async () => {
    useDeps(db, stubModel('{}'))
    const a = await createGroup()
    const b = await createGroup()
    expect(a.yearbookToken).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(new Set([a.id, a.inviteToken, a.yearbookToken, b.yearbookToken]).size).toBe(4)
    expect(a.yearbookUrl).toBe(`http://localhost:3000/y/${a.yearbookToken}`)
  })
})

describe('GET /y/:token (yearbook page)', () => {
  it('says the awards are not ready before they are made, and still links the report form', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()
    await submit(group.id, 'Ana')
    const page = await getPage(`/y/${group.yearbookToken}`)
    expect(page.status).toBe(200)
    expect(page.html).toContain('ready yet')
    expect(hrefs(page.html)).toContain(`/y/${group.yearbookToken}/report`)
    expect(hrefs(page.html).filter((href) => href.endsWith('.png'))).toEqual([])
  })

  it('lists everyone after a remake, in the order they answered', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    await submit(group.id, 'Dan')
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat', 'Dan'], 'Remade')))
    expect((await api('POST', `/groups/${group.id}/generate`)).status).toBe(200)

    const { html } = await getPage(`/y/${group.yearbookToken}`)
    const positions = ['Remade Ana Award', 'Remade Ben Award', 'Remade Cat Award', 'Remade Dan Award'].map((t) => html.indexOf(t))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((x, y) => x - y)).toEqual(positions)
  })

  it('never reveals the organizer id or the invite token', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: await photoDataUrl({ width: 32, height: 32 }) })
    const page = await getPage(`/y/${group.yearbookToken}`)
    const loaded = JSON.stringify(await getYearbook(db, group.yearbookToken))
    for (const secret of [group.id, group.inviteToken]) {
      expect(page.html).not.toContain(secret)
      expect(loaded).not.toContain(secret)
    }
  })

  it('returns 404 for the organizer id or the invite token used as a yearbook token', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect((await getPage(`/y/${group.id}`)).status).toBe(404)
    expect((await getPage(`/y/${group.inviteToken}`)).status).toBe(404)
    expect(await getYearbook(db, group.id)).toBeNull()
  })

  it('links every slide, and shows a photo only for friends who added one', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: await photoDataUrl({ width: 32, height: 32 }) })
    const { html } = await getPage(`/y/${group.yearbookToken}`)
    const photos = [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1])
    expect(photos).toEqual([fileUrl(group.yearbookToken, 'Ana', 'jpg')])
    expect(html).toMatch(/<a [^>]*download="[^"]*"/)
  })

  it('encodes names with slashes, percent signs and hashes in every link, and each link works', async () => {
    const names = ['Jo/Jo', '100% Cat', 'Ana #1']
    const photo = await photoDataUrl({ width: 32, height: 32 })
    const group = await groupWithAwards(db, names, Object.fromEntries(names.map((n) => [n, photo])))
    const { html } = await getPage(`/y/${group.yearbookToken}`)
    const links = hrefs(html).filter((href) => href.endsWith('.png'))
    const photos = [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1])
    expect(links).toEqual(names.map((n) => fileUrl(group.yearbookToken, n, 'png')))
    expect(photos).toEqual(names.map((n) => fileUrl(group.yearbookToken, n, 'jpg')))
    for (const path of [...links, ...photos]) expect((await getBinary(path)).status, path).toBe(200)
  })

  it('mentions the preview watermark only while the group is locked', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect((await getPage(`/y/${group.yearbookToken}`)).html).toMatch(/preview/i)
    await setUnlocked(db, group.id)
    expect((await getPage(`/y/${group.yearbookToken}`)).html).not.toMatch(/preview/i)
  })

  it('carries a "make yours" link to the home page', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const { html } = await getPage(`/y/${group.yearbookToken}`)
    expect(hrefs(html)).toContain('/')
    expect(html).toMatch(/Make your own/)
  })
})

describe('the yearbook token opens only the yearbook', () => {
  it('cannot be used as an invite token or as the organizer id, and adds nothing when tried', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], {}, { memberCount: 5 })
    const yb = group.yearbookToken
    const dan = submissionBody('Dan')
    // Friend side: the form and submitting.
    expect(await getInvite(db, yb)).toBeNull()
    expect((await api('POST', `/join/${yb}/submissions`, dan)).status).toBe(404)
    // Organizer side: page, submit, generate, awards, slides, pending.
    expect((await getPage(`/groups/${yb}`)).status).toBe(404)
    expect(await getDashboard(db, yb)).toBeNull()
    expect((await api('POST', `/groups/${yb}/submissions`, dan)).status).toBe(404)
    expect((await api('POST', `/groups/${yb}/generate`)).status).toBe(404)
    expect((await api('GET', `/groups/${yb}/awards`)).status).toBe(404)
    expect((await getBinary(`/groups/${yb}/awards/Ana.png`)).status).toBe(404)
    expect((await api('GET', `/groups/${yb}/pending`)).status).toBe(404)
    expect((await getDashboard(db, group.id))?.submissions.map((s) => s.displayName)).toEqual(['Ana', 'Ben', 'Cat'])
  })
})

describe('GET /y/:token/:name.png and .jpg', () => {
  it('serves the slide as a 1080x1920 PNG with the same watermark rules as the organizer’s', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const locked = await getBinary(fileUrl(group.yearbookToken, 'Ben', 'png'))
    expect(locked.status).toBe(200)
    expect(locked.headers.get('content-type')).toBe('image/png')
    expect(await sharp(locked.bytes).metadata()).toMatchObject({ width: 1080, height: 1920 })
    expect(await comments(locked.bytes)).toHaveProperty(WATERMARK_KEYWORD, 'preview')
    expect(locked.headers.get('x-squadwrap-watermark')).toBe('preview')
    expect(locked.headers.get('cache-control')).toBe('private, no-store')

    await setUnlocked(db, group.id)
    const unlocked = await getBinary(fileUrl(group.yearbookToken, 'Ben', 'png'))
    expect(await comments(unlocked.bytes)).not.toHaveProperty(WATERMARK_KEYWORD)
    expect(unlocked.headers.has('x-squadwrap-watermark')).toBe(false)
  })

  it('matches the name regardless of case', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect((await getBinary(`/y/${group.yearbookToken}/aNA.png`)).status).toBe(200)
  })

  it('serves the stored photo as a JPEG, privately and never content-sniffed', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: await photoDataUrl({ width: 64, height: 48 }) })
    const res = await getBinary(fileUrl(group.yearbookToken, 'Ana', 'jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    expect(res.bytes.equals((await storedPhoto(db, group.id, 'Ana'))!)).toBe(true)
  })

  it('answers a repeat view with 304, and stops serving a photo the moment it is taken down', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: await photoDataUrl({ width: 64, height: 48 }) })
    const path = fileUrl(group.yearbookToken, 'Ana', 'jpg')
    const first = await getBinary(path)
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/^"[\w-]+"$/)

    const again = await getBinary(path, { 'if-none-match': `W/"other", ${etag}` })
    expect(again.status).toBe(304)
    expect(again.bytes.length).toBe(0)
    expect(again.headers.get('cache-control')).toBe('private, no-cache')
    expect((await getBinary(path, { 'if-none-match': '"stale"' })).status).toBe(200)

    // The operator's takedown (BUILD.md, "Handling reports").
    await db.query(`UPDATE submissions SET photo = NULL WHERE group_id = $1 AND display_name = 'Ana'`, [group.id])
    expect((await getBinary(path, { 'if-none-match': etag })).status).toBe(404)
    expect((await getPage(`/y/${group.yearbookToken}`)).html).not.toContain('<img')
  })

  it('returns 404 for a wrong token, and for the organizer id or invite token used as one', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: await photoDataUrl({ width: 32, height: 32 }) })
    for (const token of ['not-a-real-token-0000000', group.id, group.inviteToken]) {
      for (const ext of ['png', 'jpg']) {
        const res = await getBinary(fileUrl(token, 'Ana', ext))
        expect(res.status, `${token}.${ext}`).toBe(404)
        expect(JSON.parse(res.bytes.toString()).error.code).toBe('group_not_found')
      }
    }
  })

  it('returns 404 for an unknown name, for a friend without a photo, and before the awards are made', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const code = async (path: string) => {
      const res = await getBinary(path)
      expect(res.status, path).toBe(404)
      return JSON.parse(res.bytes.toString()).error.code
    }
    expect(await code(fileUrl(group.yearbookToken, 'Dan', 'png'))).toBe('award_not_found')
    expect(await code(fileUrl(group.yearbookToken, 'Dan', 'jpg'))).toBe('award_not_found')
    expect(await code(fileUrl(group.yearbookToken, 'Ben', 'jpg'))).toBe('photo_not_found')
    await db.query('DELETE FROM awards WHERE group_id = $1', [group.id])
    expect(await code(fileUrl(group.yearbookToken, 'Ana', 'png'))).toBe('award_not_found')
  })

  it('returns 404 for anything but .png and .jpg', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    for (const file of ['Ana', 'Ana.gif', 'Ana.png.txt', '.png', '.jpg']) {
      expect((await getBinary(`/y/${group.yearbookToken}/${encodeURIComponent(file)}`)).status, file).toBe(404)
    }
  })
})

describe('reports', () => {
  const reportsOf = async (groupId: string) =>
    (await db.query<{ reason: string; contact: string | null }>('SELECT reason, contact FROM reports WHERE group_id = $1 ORDER BY id', [groupId]))
      .rows

  it('stores a report for the group, tidied', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const res = await api('POST', `/y/${group.yearbookToken}/reports`, {
      reason: '  Ben’s award\nmentions my health. ',
      contact: ' ana@example.com ',
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ received: true })
    expect(JSON.stringify(res.body)).not.toContain(group.id)
    expect(await reportsOf(group.id)).toEqual([{ reason: 'Ben’s award mentions my health.', contact: 'ana@example.com' }])
  })

  it('takes a report without contact details', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    for (const contact of [undefined, null, '', '   ']) {
      expect((await api('POST', `/y/${group.yearbookToken}/reports`, { reason: 'Remove my photo', contact })).status).toBe(201)
    }
    expect((await reportsOf(group.id)).map((r) => r.contact)).toEqual([null, null, null, null])
  })

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a reason that is not text', { reason: 42 }],
    ['a reason that is too long', { reason: 'x'.repeat(LIMITS.reportReason + 1) }],
    ['contact details that are too long', { reason: 'Bad', contact: 'x'.repeat(LIMITS.reportContact + 1) }],
    ['contact details that are not text', { reason: 'Bad', contact: { email: 'x' } }],
  ])('rejects %s with 400 and stores nothing', async (_label, body) => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const res = await api('POST', `/y/${group.yearbookToken}/reports`, body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(await reportsOf(group.id)).toEqual([])
  })

  it('rejects a body that is not JSON with 400', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect((await api('POST', `/y/${group.yearbookToken}/reports`, '{"reason": ')).status).toBe(400)
  })

  it('returns 404 for a wrong token, or the organizer id used as one', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    for (const token of ['not-a-real-token-0000000', group.id, group.inviteToken]) {
      expect((await api('POST', `/y/${token}/reports`, { reason: 'Bad' })).status).toBe(404)
    }
    expect(await reportsOf(group.id)).toEqual([])
  })

  it(`takes at most ${LIMITS.reportsPerGroupPerHour} reports per group in an hour (429), without affecting other groups`, async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const other = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    for (let i = 1; i <= LIMITS.reportsPerGroupPerHour; i++) {
      expect((await api('POST', `/y/${group.yearbookToken}/reports`, { reason: `Report ${i}` })).status).toBe(201)
    }
    const res = await api('POST', `/y/${group.yearbookToken}/reports`, { reason: 'One more' })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('too_many_reports')
    expect(await reportsOf(group.id)).toHaveLength(LIMITS.reportsPerGroupPerHour)
    expect((await api('POST', `/y/${other.yearbookToken}/reports`, { reason: 'Mine' })).status).toBe(201)
  })

  it('takes reports again once the flood is more than an hour old, so a real takedown request is never blocked for long', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    for (let i = 1; i <= LIMITS.reportsPerGroupPerHour; i++) {
      await api('POST', `/y/${group.yearbookToken}/reports`, { reason: `Junk ${i}` })
    }
    expect((await api('POST', `/y/${group.yearbookToken}/reports`, { reason: 'Real' })).status).toBe(429)
    await db.query(`UPDATE reports SET created_at = now() - interval '61 minutes' WHERE group_id = $1`, [group.id])
    expect((await api('POST', `/y/${group.yearbookToken}/reports`, { reason: 'Please remove my photo' })).status).toBe(201)
    expect(await reportsOf(group.id)).toHaveLength(LIMITS.reportsPerGroupPerHour + 1)
  })

  it('serves the report page with a noindex tag, and 404 for a wrong token', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const page = await getPage(`/y/${group.yearbookToken}/report`)
    expect(page.status).toBe(200)
    expect(page.head).toContain('<meta name="robots" content="noindex, nofollow"/>')
    expect(page.html).toMatch(/<textarea [^>]*name="reason"/)
    expect(page.html).not.toContain(group.id)
    expect(hrefs(page.html)).toContain(`/y/${group.yearbookToken}`)
    expect((await getPage('/y/not-a-real-token-0000000/report')).status).toBe(404)
  })
})

describe('GET /groups/:id/pending', () => {
  it('returns who answered, in order, the invite URL and a nudge message', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup('Flat 4B', { memberCount: 5, year: 2026 })
    for (const name of ['Cat', 'Ana', 'Ben']) await submit(group.id, name)

    const res = await api('GET', `/groups/${group.id}/pending`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ memberCount: 5, submitted: 3, pending: 2, answered: ['Cat', 'Ana', 'Ben'] })
    expect(res.body.inviteUrl).toBe(`http://localhost:3000/join/${group.inviteToken}`)
    expect(res.body.nudge).toContain('3 of 5 have answered (Cat, Ana and Ben). 2 to go!')
    expect(res.body.nudge).toContain(res.body.inviteUrl)
    expect(JSON.stringify(res.body)).not.toContain(group.id)
  })

  it('has a null pending count without a member count, and still a nudge', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()
    await submit(group.id, 'Ana')
    const res = await api('GET', `/groups/${group.id}/pending`)
    expect(res.body).toMatchObject({ memberCount: null, submitted: 1, pending: null })
    expect(res.body.nudge).toContain('1 has answered (Ana). Your turn!')
  })

  it('counts nobody as pending (and has no nudge) once more friends answered than were counted', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup('Flat 4B', { memberCount: 3 })
    for (const name of ['Ana', 'Ben', 'Cat', 'Dan']) await submit(group.id, name)
    const res = await api('GET', `/groups/${group.id}/pending`)
    expect(res.body).toMatchObject({ submitted: 4, pending: 0, nudge: null })
  })

  it('counts everyone as pending before anyone answers', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup('Flat 4B', { memberCount: 6 })
    const res = await api('GET', `/groups/${group.id}/pending`)
    expect(res.body).toMatchObject({ submitted: 0, pending: 6, answered: [] })
    expect(res.body.nudge).toContain('nobody has answered yet')
  })

  it('returns 404 for an unknown id, and for the invite or yearbook token used as an id', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()
    for (const id of ['no-such-group-000000000', group.inviteToken, group.yearbookToken]) {
      const res = await api('GET', `/groups/${id}/pending`)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('group_not_found')
    }
  })
})

describe('organizer page', () => {
  it('shows a placeholder per friend still to answer and the nudge message', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup('Flat 4B', { memberCount: 5, year: 2026 })
    for (const name of ['Ana', 'Ben', 'Cat']) await submit(group.id, name)
    const { status, html } = await getPage(`/groups/${group.id}`)
    expect(status).toBe(200)
    expect(html.match(/aria-label="Not answered yet"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Nudge message"')
    expect(html).toContain('3 of 5 have answered (Ana, Ben and Cat). 2 to go!')
    expect(html).toContain(`/join/${group.inviteToken}`)
  })

  it('has no nudge once everyone counted has answered', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup('Flat 4B', { memberCount: 3 })
    for (const name of ['Ana', 'Ben', 'Cat']) await submit(group.id, name)
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).toContain('Ana')
    expect(html).not.toContain('aria-label="Nudge message"')
    expect(html).not.toContain('aria-label="Not answered yet"')
  })

  it('still nudges without a member count, with no placeholders', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()
    for (const name of ['Ana', 'Ben']) await submit(group.id, name)
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).toContain('2 have answered (Ana and Ben). Your turn!')
    expect(html).not.toContain('aria-label="Not answered yet"')
  })

  it('points the download buttons at the yearbook, never at the organizer key, and shares the yearbook link', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], {}, { memberCount: 3 })
    const { html } = await getPage(`/groups/${group.id}`)
    const slides = hrefs(html).filter((href) => href.endsWith('.png'))
    expect(slides).toEqual(['Ana', 'Ben', 'Cat'].map((n) => `/y/${group.yearbookToken}/${n}.png`))
    expect(html).toContain(`value="/y/${group.yearbookToken}"`)
  })

  it('offers the yearbook link only once the awards exist', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()
    await submit(group.id, 'Ana')
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).not.toContain(`/y/${group.yearbookToken}`)
  })

  it('getDashboard has the pending count and the yearbook token', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup('Flat 4B', { memberCount: 4 })
    await submit(group.id, 'Ana')
    expect(await getDashboard(db, group.id)).toMatchObject({ pending: 3, yearbookToken: group.yearbookToken })
  })
})

describe('response headers on private links (next.config)', () => {
  it('keeps every page and file under a private link out of search indexes and Referer headers', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    for (const source of ['/y/:path*', '/groups/:path*', '/join/:path*']) {
      const rule = rules.find((r) => r.source === source)
      expect(rule, source).toBeDefined()
      const headers = Object.fromEntries(rule!.headers.map((h) => [h.key.toLowerCase(), h.value]))
      expect(headers['x-robots-tag']).toBe('noindex, nofollow')
      expect(headers['referrer-policy']).toBe('no-referrer')
    }
  })
})
