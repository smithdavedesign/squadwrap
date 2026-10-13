// One test (or more) per M3 exit criterion in ROADMAP.md.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '../lib/db'
import { api, createGroup, getPage, groupWithAwards, hrefs, stubModel, submit, testDb, useDeps } from './helpers'

// Pages call connection() ("render per request"), which only works inside a Next.js request; notFound() stays real.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))

let db: Db
beforeAll(async () => {
  db = await testDb()
})

describe('M3 exit criteria', () => {
  it('EC1: GET /y/:token lists all awards for the group', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const { body } = await api('GET', `/groups/${group.id}/awards`)
    expect(body.awards).toHaveLength(3)

    const page = await getPage(`/y/${group.yearbookToken}`)
    expect(page.status).toBe(200)
    for (const award of body.awards) {
      expect(page.html).toContain(award.displayName)
      expect(page.html).toContain(award.title)
      expect(page.html).toContain(award.citation)
    }
    // One entry per award, each with its slide.
    const slides = hrefs(page.html).filter((href) => href.endsWith('.png'))
    expect(slides.sort()).toEqual(['Ana', 'Ben', 'Cat'].map((name) => `/y/${group.yearbookToken}/${name}.png`))
  })

  it('EC1: GET /y/:token with a wrong token returns 404', async () => {
    await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect((await getPage('/y/not-a-real-token-0000000')).status).toBe(404)
    expect((await getPage('/y/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404)
  })

  it('EC2: GET /groups/:id/pending with member count 5 and 3 submissions returns a pending count of 2', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup('Flat 4B', { memberCount: 5 })
    for (const name of ['Ana', 'Ben', 'Cat']) expect((await submit(group.id, name)).status).toBe(201)

    const res = await api('GET', `/groups/${group.id}/pending`)
    expect(res.status).toBe(200)
    expect(res.body.pending).toBe(2)
    expect(res.body).toMatchObject({ memberCount: 5, submitted: 3 })
  })

  it('EC3: the yearbook page includes a report link, and it leads to a working report form', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const page = await getPage(`/y/${group.yearbookToken}`)

    const reportPath = `/y/${group.yearbookToken}/report`
    expect(hrefs(page.html)).toContain(reportPath)
    expect(page.html).toMatch(/<a [^>]*href="\/y\/[^"]+\/report"[^>]*>[^<]*Report/)

    const form = await getPage(reportPath)
    expect(form.status).toBe(200)
    expect(form.html).toContain('<form')
    const sent = await api('POST', `/y/${group.yearbookToken}/reports`, { reason: 'Please take my photo down.' })
    expect(sent.status).toBe(201)
  })

  it('EC3: the yearbook page includes a noindex meta tag', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const page = await getPage(`/y/${group.yearbookToken}`)
    expect(page.status).toBe(200)
    expect(page.head).toContain('<meta name="robots" content="noindex, nofollow"/>')
  })
})
