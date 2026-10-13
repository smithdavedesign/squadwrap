// One test (or more) per M1 exit criterion in ROADMAP.md.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../lib/db'
import { api, awardsJson, countAwards, createGroup, stubModel, submit, testDb, useDeps } from './helpers'

let db: Db
beforeAll(async () => {
  db = await testDb()
})

describe('M1 exit criteria', () => {
  it('EC1: POST /groups with name "Flat 4B" returns an id and an invite URL containing a token', async () => {
    useDeps(db, stubModel('{}'))
    const res = await api('POST', '/groups', { name: 'Flat 4B' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Flat 4B')
    expect(typeof res.body.id).toBe('string')
    expect(res.body.id.length).toBeGreaterThanOrEqual(20)
    expect(res.body.inviteToken).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(res.body.inviteToken).not.toBe(res.body.id)
    expect(res.body.inviteUrl).toContain(res.body.inviteToken)
    expect(new URL(res.body.inviteUrl).pathname).toBe(`/join/${res.body.inviteToken}`)
  })

  it('EC2: three different display names each return 201; a fourth reusing a display name returns 409', async () => {
    useDeps(db, stubModel('{}'))
    const group = await createGroup()

    for (const name of ['Ana', 'Ben', 'Cat']) {
      const res = await submit(group.id, name)
      expect(res.status, `submission by ${name}`).toBe(201)
    }
    const dup = await submit(group.id, 'Ben')
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('duplicate_name')
  })

  it('EC3: generate with 2 submissions returns 422 and does not call the model', async () => {
    const model = stubModel(awardsJson(['Ana', 'Ben']))
    useDeps(db, model)
    const group = await createGroup()
    await submit(group.id, 'Ana')
    await submit(group.id, 'Ben')

    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('not_enough_submissions')
    expect(model.calls).toHaveLength(0)
  })

  it('EC3: generate with 3 submissions returns 200 and exactly 3 awards, one per display name, each with a title and citation', async () => {
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat'])))
    const group = await createGroup()
    for (const name of ['Ana', 'Ben', 'Cat']) await submit(group.id, name)

    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(200)
    expect(res.body.awards).toHaveLength(3)
    expect(res.body.awards.map((a: { displayName: string }) => a.displayName).sort()).toEqual(['Ana', 'Ben', 'Cat'])
    for (const award of res.body.awards) {
      expect(typeof award.title).toBe('string')
      expect(award.title.trim()).not.toBe('')
      expect(typeof award.citation).toBe('string')
      expect(award.citation.trim()).not.toBe('')
    }
    expect(await countAwards(db, group.id)).toBe(3)
  })

  it('EC4: with the model returning malformed JSON, generate returns 502 and stores no awards', async () => {
    useDeps(db, stubModel('Sure! Here are your awards: {"awards": [{"name": "Ana", "title": "Queen of'))
    const group = await createGroup()
    for (const name of ['Ana', 'Ben', 'Cat']) await submit(group.id, name)

    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('model_bad_output')
    expect(await countAwards(db, group.id)).toBe(0)
    const listed = await api('GET', `/groups/${group.id}/awards`)
    expect(listed.status).toBe(200)
    expect(listed.body.awards).toEqual([])
  })

  it('EC4: with the model returning JSON that is only partly valid, generate returns 502 and stores none of it', async () => {
    const partial = JSON.stringify({
      awards: [
        { id: 1, name: 'Ana', title: 'Lore Keeper', citation: 'Remembers everything. Forgives nothing.' },
        { id: 2, name: 'Ben', title: 'Snooze Button', citation: 'Five more minutes. Every time.' },
        { id: 3, name: 'Cat', title: '   ', citation: 'Untitled, like her plans.' },
      ],
    })
    useDeps(db, stubModel(partial))
    const group = await createGroup()
    for (const name of ['Ana', 'Ben', 'Cat']) await submit(group.id, name)

    const res = await api('POST', `/groups/${group.id}/generate`)
    expect(res.status).toBe(502)
    expect(await countAwards(db, group.id)).toBe(0)
  })

  it('EC5: GET /groups/:id/awards for an unknown id returns 404', async () => {
    useDeps(db, stubModel('{}'))
    const res = await api('GET', '/groups/does-not-exist-0000000/awards')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('group_not_found')
  })
})
