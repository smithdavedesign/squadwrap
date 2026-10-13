// The pending count and the nudge message (lib/nudge.ts), shared by the organizer page and GET /groups/:id/pending.
import { describe, expect, it } from 'vitest'
import { nameList, nudgeText, pendingCount } from '../lib/nudge'
import { PROMPTS } from '../lib/prompts'

const URL = 'https://squadwrap.example/join/tok'
const base = { groupName: 'Flat 4B', year: 2026, inviteUrl: URL }

describe('pendingCount', () => {
  it('is the member count minus who answered', () => {
    expect(pendingCount(5, 3)).toBe(2)
    expect(pendingCount(5, 0)).toBe(5)
  })

  it('is null when the organizer gave no member count', () => {
    expect(pendingCount(null, 3)).toBeNull()
  })

  it('never goes below zero when more friends answered than were counted', () => {
    expect(pendingCount(3, 5)).toBe(0)
  })
})

describe('nameList', () => {
  it.each([
    [[], ''],
    [['Ana'], 'Ana'],
    [['Ana', 'Ben'], 'Ana and Ben'],
    [['Ana', 'Ben', 'Cat'], 'Ana, Ben and Cat'],
    [['A', 'B', 'C', 'D', 'E', 'F'], 'A, B, C, D, E and F'],
    [['A', 'B', 'C', 'D', 'E', 'F', 'G'], 'A, B, C, D, E, F and 1 other'],
    [['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], 'A, B, C, D, E, F and 3 others'],
  ])('lists %j as %j', (names, expected) => {
    expect(nameList(names)).toBe(expected)
  })
})

describe('nudgeText', () => {
  it('says how many of how many answered, who, how many are left, and links the invite', () => {
    const text = nudgeText({ ...base, answered: ['Ana', 'Ben', 'Cat'], memberCount: 5 })
    expect(text).toBe(
      `Flat 4B, 2026 wrapped: 3 of 5 have answered (Ana, Ben and Cat). 2 to go! ${PROMPTS.length} quick prompts, no app needed: ${URL}`,
    )
  })

  it('reads right with a single answer and one left', () => {
    const text = nudgeText({ ...base, answered: ['Ana'], memberCount: 2 })
    expect(text).toContain('1 of 2 has answered (Ana). 1 to go!')
  })

  it('works without a member count', () => {
    const text = nudgeText({ ...base, answered: ['Ana', 'Ben'], memberCount: null })
    expect(text).toContain('2 have answered (Ana and Ben). Your turn!')
    expect(text).not.toContain(' of ')
    expect(text).toContain(URL)
  })

  it('asks for the first answer when nobody has answered', () => {
    for (const memberCount of [5, null]) {
      const text = nudgeText({ ...base, answered: [], memberCount })
      expect(text).toContain('nobody has answered yet. Be the first!')
      expect(text).toContain(URL)
    }
  })

  it('is null when everyone counted has answered', () => {
    expect(nudgeText({ ...base, answered: ['Ana', 'Ben', 'Cat'], memberCount: 3 })).toBeNull()
    expect(nudgeText({ ...base, answered: ['Ana', 'Ben', 'Cat', 'Dan'], memberCount: 3 })).toBeNull()
  })

  it('keeps a long list short', () => {
    const answered = Array.from({ length: 19 }, (_, i) => `Friend ${i + 1}`)
    const text = nudgeText({ ...base, answered, memberCount: 20 })
    expect(text).toContain('Friend 6 and 13 others). 1 to go!')
    expect(text).not.toContain('Friend 7,')
  })
})
