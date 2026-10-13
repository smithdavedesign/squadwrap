// Safety and legal (M4) beyond the exit criteria: the adults-only gate, the friend form's checkbox, the privacy
// and terms pages, and the footer on every page.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import RootLayout from '../app/layout'
import type { Db } from '../lib/db'
import { LIMITS, UNLOCK_PRICE } from '../lib/prompts'
import { api, contentsOf, createGroup, getPage, hrefs, stubModel, submissionBody, testDb, useDeps } from './helpers'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}))

let db: Db
beforeAll(async () => {
  db = await testDb()
})
beforeEach(() => {
  useDeps(db, stubModel('{}'))
})

describe('the adults-only gate', () => {
  it.each([
    ['unticked (false)', false],
    ['the text "true"', 'true'],
    ['the number 1', 1],
    ['null', null],
  ])('rejects %s with 400 adults_only', async (_label, adult) => {
    const group = await createGroup()
    const res = await api('POST', `/join/${group.inviteToken}/submissions`, { ...submissionBody('Ana'), adult })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('adults_only')
    expect((await contentsOf(db, group.id)).submissions).toBe(0)
  })

  it('is checked before anything else: the group, the answers and the photo', async () => {
    const undecodable = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 7)]).toString('base64')
    const { adult: _ticked, ...unticked } = submissionBody('Ana', { lore: '' }, undecodable)
    for (const path of ['/groups/no-such-group-000000000/submissions', '/join/no-such-token-0000000/submissions']) {
      const res = await api('POST', path, unticked)
      expect(res.status, path).toBe(400)
      expect(res.body.error.code).toBe('adults_only')
    }
  })
})

describe('the friend form', () => {
  it('has a required "18 or older" checkbox and says when answers are deleted', async () => {
    const group = await createGroup()
    const { status, html } = await getPage(`/join/${group.inviteToken}`)
    expect(status).toBe(200)
    const box = html.match(/<input[^>]*name="adult"[^>]*>/)?.[0] ?? ''
    expect(box).toContain('type="checkbox"')
    expect(box).toContain('required')
    expect(html).toMatch(/18 or older/)
    expect(html).toContain(`${LIMITS.retentionDays} days`)
  })
})

describe('the home page', () => {
  it('says squadwrap is for adults', async () => {
    const { html } = await getPage('/')
    expect(html).toMatch(/18\+|adults/i)
  })
})

describe('privacy and terms', () => {
  it('the privacy page says where data goes and when it is deleted', async () => {
    const { status, html } = await getPage('/privacy')
    expect(status).toBe(200)
    // The four points M3 left for this page, plus payment and retention.
    expect(html).toMatch(/AI provider/)
    expect(html).toMatch(/Gemini/)
    // Whatever provider is configured, and everything sent to it (lib/model.ts buildMessages).
    expect(html).toMatch(/group’s name and year[^<]*configured AI provider/)
    expect(html).toMatch(/photo/i)
    expect(html).toMatch(/Google Fonts/)
    expect(html).toMatch(/report/i)
    expect(html).toMatch(/Stripe/)
    expect(html).toContain(`${LIMITS.retentionDays} days`)
    expect(html).toMatch(/no (ads|tracking)/i)
  })

  it('the terms say who may use it, what the payment buys, refunds and how to get something taken down', async () => {
    const { status, html } = await getPage('/terms')
    expect(status).toBe(200)
    expect(html).toMatch(/18/)
    expect(html).toContain(UNLOCK_PRICE.label)
    expect(html).toMatch(/refund/i)
    expect(html).toMatch(/watermark/i)
    expect(html).toContain('id="report"')
    expect(html).toMatch(/Report it or ask for a takedown/)
    expect(html).toContain(`${LIMITS.retentionDays} days`)
  })

  it('both pages link each other', async () => {
    expect(hrefs((await getPage('/privacy')).html)).toContain('/terms')
    expect(hrefs((await getPage('/terms')).html)).toContain('/privacy')
  })
})

describe('the footer on every page (root layout)', () => {
  it('links privacy, terms and the takedown route', () => {
    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement('p', null, 'page')))
    const links = hrefs(html)
    expect(links).toEqual(expect.arrayContaining(['/privacy', '/terms', '/terms#report']))
    expect(html).toMatch(/<footer[^>]*>[\s\S]*Report a problem[\s\S]*<\/footer>/)
    expect(html).toContain('<p>page</p>')
  })
})
