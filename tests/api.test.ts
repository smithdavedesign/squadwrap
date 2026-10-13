// Edge and error paths of the M1 API beyond the exit criteria.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../lib/db'
import { ModelUnavailableError } from '../lib/model'
import { LIMITS } from '../lib/prompts'
import { getDashboard, getInvite } from '../lib/squad'
import { answersFor, api, awardsJson, countAwards, createGroup, stubModel, submissionBody, submit, testDb, useDeps } from './helpers'

let db: Db
beforeAll(async () => {
  db = await testDb()
})
beforeEach(() => {
  useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat'])))
})

async function groupWith(names: string[]) {
  const group = await createGroup()
  for (const name of names) expect((await submit(group.id, name)).status).toBe(201)
  return group
}

describe('POST /groups', () => {
  it('stores year and member count when given', async () => {
    const res = await api('POST', '/groups', { name: 'Book Club', year: 2025, memberCount: 6 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Book Club', year: 2025, memberCount: 6 })
  })

  it('defaults the year to the current year and the member count to null', async () => {
    const res = await api('POST', '/groups', { name: 'Book Club' })
    expect(res.body.year).toBe(new Date().getUTCFullYear())
    expect(res.body.memberCount).toBeNull()
  })

  it('trims and collapses whitespace in the group name', async () => {
    const res = await api('POST', '/groups', { name: '  Flat   4B ' })
    expect(res.body.name).toBe('Flat 4B')
  })

  it('gives every group a distinct id and invite token', async () => {
    const a = await createGroup()
    const b = await createGroup()
    expect(new Set([a.id, b.id, a.inviteToken, b.inviteToken]).size).toBe(4)
  })

  it.each([
    ['no name', {}],
    ['empty name', { name: '' }],
    ['blank name', { name: '   ' }],
    ['name too long', { name: 'x'.repeat(LIMITS.groupName + 1) }],
    ['name not a string', { name: 42 }],
    ['year too early', { name: 'A', year: 1999 }],
    ['year not a number', { name: 'A', year: 'soon' }],
    ['member count below 3', { name: 'A', memberCount: 2 }],
    ['member count above the cap', { name: 'A', memberCount: LIMITS.maxMembers + 1 }],
    ['fractional member count', { name: 'A', memberCount: 4.5 }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await api('POST', '/groups', body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
  })

  it('rejects a body that is not JSON with 400', async () => {
    const res = await api('POST', '/groups', '{"name": "Flat')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_json')
  })

  it('rejects a JSON body that is not an object with 400', async () => {
    const res = await api('POST', '/groups', ['Flat 4B'])
    expect(res.status).toBe(400)
  })
})

describe('POST /groups/:id/submissions', () => {
  it('returns the display name as typed, trimmed', async () => {
    const group = await createGroup()
    const res = await submit(group.id, '  Ana  B. ')
    expect(res.status).toBe(201)
    expect(res.body.displayName).toBe('Ana B.')
  })

  it('treats display names that differ only in case or spacing as the same person (409)', async () => {
    const group = await createGroup()
    expect((await submit(group.id, 'Sam')).status).toBe(201)
    expect((await submit(group.id, '  sAM ')).status).toBe(409)
  })

  it('treats names that differ only by invisible characters as the same person (409)', async () => {
    const group = await createGroup()
    expect((await submit(group.id, 'Sam')).status).toBe(201)
    const zeroWidthJoiner = String.fromCodePoint(0x200d)
    const softHyphen = String.fromCodePoint(0xad)
    expect((await submit(group.id, `Sam${zeroWidthJoiner}`)).status).toBe(409)
    expect((await submit(group.id, `S${softHyphen}am`)).status).toBe(409)
  })

  it('allows the same display name in different groups', async () => {
    const a = await createGroup()
    const b = await createGroup()
    expect((await submit(a.id, 'Sam')).status).toBe(201)
    expect((await submit(b.id, 'Sam')).status).toBe(201)
  })

  it('returns 404 for an unknown group', async () => {
    const res = await submit('no-such-group-000000000', 'Ana')
    expect(res.status).toBe(404)
  })

  const answers = answersFor('Ana')
  it.each([
    ['no display name', { answers }],
    ['blank display name', { displayName: '  ', answers }],
    ['display name too long', { displayName: 'x'.repeat(LIMITS.displayName + 1), answers }],
    ['an invisible display name', { displayName: String.fromCodePoint(0x200d, 0xad), answers }],
    ['no answers', { displayName: 'Ana' }],
    ['answers not an object', { displayName: 'Ana', answers: 'lol' }],
    ['a missing answer', { displayName: 'Ana', answers: { ...answers, lore: undefined } }],
    ['a blank answer', { displayName: 'Ana', answers: { ...answers, lore: '   ' } }],
    ['an answer that is not text', { displayName: 'Ana', answers: { ...answers, lore: 7 } }],
    ['an answer that is too long', { displayName: 'Ana', answers: { ...answers, lore: 'x'.repeat(LIMITS.answer + 1) } }],
  ])('rejects %s with 400', async (_label, body) => {
    const group = await createGroup()
    // The adults-only box is ticked (M4), so each 400 is about the field under test.
    const res = await api('POST', `/groups/${group.id}/submissions`, { ...body, adult: true })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
  })

  it(`caps a group at ${LIMITS.maxMembers} submissions (409 group_full)`, async () => {
    const group = await createGroup()
    for (let i = 1; i <= LIMITS.maxMembers; i++) expect((await submit(group.id, `Friend ${i}`)).status).toBe(201)
    const res = await submit(group.id, 'One Too Many')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('group_full')
  })
})

describe('POST /join/:token/submissions (friend link)', () => {
  it('accepts a submission by invite token, counts it for the group and does not reveal the group id', async () => {
    const group = await createGroup()
    const res = await api('POST', `/join/${group.inviteToken}/submissions`, submissionBody('Ana'))
    expect(res.status).toBe(201)
    expect(JSON.stringify(res.body)).not.toContain(group.id)

    const dashboard = await getDashboard(db, group.id)
    expect(dashboard?.submissions.map((s) => s.displayName)).toEqual(['Ana'])
  })

  it('rejects a duplicate name through the invite link too (409)', async () => {
    const group = await createGroup()
    await submit(group.id, 'Ana')
    const res = await api('POST', `/join/${group.inviteToken}/submissions`, submissionBody('ana', answersFor('Ana')))
    expect(res.status).toBe(409)
  })

  it('returns 404 for a wrong token, including a group id used as a token', async () => {
    const group = await createGroup()
    const body = submissionBody('Ana')
    expect((await api('POST', '/join/not-a-real-token-00000/submissions', body)).status).toBe(404)
    expect((await api('POST', `/join/${group.id}/submissions`, body)).status).toBe(404)
  })
})

describe('POST /groups/:id/generate', () => {
  it('returns 404 for an unknown group without calling the model', async () => {
    const model = stubModel(awardsJson(['Ana']))
    useDeps(db, model)
    const res = await api('POST', '/groups/no-such-group-000000000/generate')
    expect(res.status).toBe(404)
    expect(model.calls).toHaveLength(0)
  })

  it('sends every submission and answer to the model', async () => {
    const model = stubModel(awardsJson(['Ana', 'Ben', 'Cat']))
    useDeps(db, model)
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    await api('POST', `/groups/${group.id}/generate`)

    expect(model.calls).toHaveLength(1)
    const sent = model.calls[0].map((m) => m.content).join('\n')
    for (const name of ['Ana', 'Ben', 'Cat']) {
      expect(sent).toContain(name)
      expect(sent).toContain(answersFor(name).mainCharacter)
    }
    expect(sent).toContain('Flat 4B')
  })

  it('returns 502 model_unavailable when the model call fails, storing nothing', async () => {
    useDeps(db, stubModel(() => Promise.reject(new ModelUnavailableError('HTTP 429'))))
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('model_unavailable')
    expect(await countAwards(db, group.id)).toBe(0)
  })

  it('treats any unexpected error from the model client as 502', async () => {
    useDeps(db, stubModel(() => Promise.reject(new TypeError('fetch failed'))))
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    expect((await api('POST', `/groups/${group.id}/generate`)).status).toBe(502)
  })

  it('returns 503 when no model is configured', async () => {
    useDeps(db, null)
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('model_not_configured')
  })

  it('returns 502 when the model leaves someone out or invents someone', async () => {
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben'])))
    expect((await api('POST', `/groups/${group.id}/generate`)).status).toBe(502)
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat', 'Dan'])))
    expect((await api('POST', `/groups/${group.id}/generate`)).status).toBe(502)
    expect(await countAwards(db, group.id)).toBe(0)
  })

  it('stores the awards so GET /groups/:id/awards returns them in submission order', async () => {
    useDeps(db, stubModel(awardsJson(['Cat', 'Ana', 'Ben'])))
    const group = await groupWith(['Cat', 'Ana', 'Ben'])
    const generated = await api('POST', `/groups/${group.id}/generate`)
    const listed = await api('GET', `/groups/${group.id}/awards`)

    expect(listed.status).toBe(200)
    expect(listed.body.group).toEqual({ id: group.id, name: 'Flat 4B', year: group.year })
    expect(listed.body.awards.map((a: { displayName: string }) => a.displayName)).toEqual(['Cat', 'Ana', 'Ben'])
    expect(listed.body.awards[0].title).toBe('The Cat Award')
    expect(listed.body.awards).toEqual(generated.body.awards)
  })

  it('never lets a slower generate overwrite newer awards that include a friend it did not see', async () => {
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    const newer = stubModel(awardsJson(['Ana', 'Ben', 'Cat', 'Dan'], 'Newer'))
    const older = stubModel(async () => {
      // While this generate waits on the model, Dan answers and a second generate finishes first.
      await submit(group.id, 'Dan')
      useDeps(db, newer)
      expect((await api('POST', `/groups/${group.id}/generate`)).status).toBe(200)
      return awardsJson(['Ana', 'Ben', 'Cat'], 'Older')
    })
    useDeps(db, older)

    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(200)
    const listed = await api('GET', `/groups/${group.id}/awards`)
    expect(listed.body.awards).toHaveLength(4)
    expect(listed.body.awards.every((a: { title: string }) => a.title.startsWith('Newer'))).toBe(true)
    expect(res.body.awards).toEqual(listed.body.awards)
  })

  it('uses the submitted spelling of each name even if the model changes it', async () => {
    useDeps(db, stubModel(awardsJson(['ana', 'BEN', ' Cat '])))
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(200)
    expect(res.body.awards.map((a: { displayName: string }) => a.displayName)).toEqual(['Ana', 'Ben', 'Cat'])
  })

  it('replaces the previous awards when generating again', async () => {
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat'], 'First')))
    await api('POST', `/groups/${group.id}/generate`)
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat'], 'Second')))
    await api('POST', `/groups/${group.id}/generate`)

    const listed = await api('GET', `/groups/${group.id}/awards`)
    expect(listed.body.awards).toHaveLength(3)
    expect(listed.body.awards.every((a: { title: string }) => a.title.startsWith('Second'))).toBe(true)
  })

  it('keeps the previous awards when a later generate fails', async () => {
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    await api('POST', `/groups/${group.id}/generate`)
    useDeps(db, stubModel('not json at all'))
    expect((await api('POST', `/groups/${group.id}/generate`)).status).toBe(502)

    const listed = await api('GET', `/groups/${group.id}/awards`)
    expect(listed.body.awards).toHaveLength(3)
  })

  it('includes friends who answered after the first generate when generating again', async () => {
    const group = await groupWith(['Ana', 'Ben', 'Cat'])
    await api('POST', `/groups/${group.id}/generate`)
    await submit(group.id, 'Dan')
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat', 'Dan'])))
    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(200)
    expect(res.body.awards).toHaveLength(4)
    expect(await countAwards(db, group.id)).toBe(4)
  })
})

describe('GET /groups/:id/awards', () => {
  it('returns the group with an empty list before anything is generated', async () => {
    const group = await groupWith(['Ana'])
    const res = await api('GET', `/groups/${group.id}/awards`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ group: { id: group.id, name: 'Flat 4B', year: group.year }, awards: [] })
  })
})

describe('page loaders', () => {
  it('getDashboard returns the group, its invite token, who answered and the awards', async () => {
    const group = await createGroup('Flat 4B', { memberCount: 5 })
    for (const name of ['Ana', 'Ben', 'Cat']) await submit(group.id, name)
    await api('POST', `/groups/${group.id}/generate`)

    const view = await getDashboard(db, group.id)
    expect(view).toMatchObject({ id: group.id, name: 'Flat 4B', year: group.year, memberCount: 5, inviteToken: group.inviteToken })
    expect(view?.submissions.map((s) => s.displayName)).toEqual(['Ana', 'Ben', 'Cat'])
    expect(view?.awards).toHaveLength(3)
  })

  it('getDashboard returns null for an unknown group', async () => {
    expect(await getDashboard(db, 'no-such-group-000000000')).toBeNull()
  })

  it('getInvite returns the group name and year but not the organizer id', async () => {
    const group = await createGroup()
    const invite = await getInvite(db, group.inviteToken)
    expect(invite).toEqual({ name: 'Flat 4B', year: group.year })
    expect(await getInvite(db, 'not-a-real-token-00000')).toBeNull()
  })
})
