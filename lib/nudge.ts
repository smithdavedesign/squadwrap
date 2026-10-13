// Shared by the organizer page (client) and GET /groups/:id/pending, so keep this file free of server imports.
import { PROMPTS } from './prompts'

/**
 * How many friends haven't answered yet: the member count the organizer gave minus who answered, never below 0.
 * Null when the organizer didn't say how many they are. There is no roster, so this is a count, not names.
 */
export function pendingCount(memberCount: number | null, answered: number): number | null {
  return memberCount === null ? null : Math.max(0, memberCount - answered)
}

/** Names shown in a nudge before the rest become "and N others", so a big group's message stays short. */
const MAX_NAMES = 6

/** "Ana", "Ana and Ben", "Ana, Ben and Cat", … "A, B, C, D, E, F and 3 others". */
export function nameList(names: readonly string[]): string {
  const rest = names.length - MAX_NAMES
  const parts = rest > 0 ? [...names.slice(0, MAX_NAMES), `${rest} ${rest === 1 ? 'other' : 'others'}`] : [...names]
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

export type NudgeInput = {
  groupName: string
  year: number
  /** Display names of who answered, in the order they did. */
  answered: readonly string[]
  memberCount: number | null
  inviteUrl: string
}

/** A message for the organizer to paste into the group chat, or null when everyone they counted has answered. */
export function nudgeText({ groupName, year, answered, memberCount, inviteUrl }: NudgeInput): string | null {
  const pending = pendingCount(memberCount, answered.length)
  if (pending === 0) return null
  const n = answered.length
  const status =
    n === 0
      ? 'nobody has answered yet. Be the first!'
      : `${memberCount === null ? n : `${n} of ${memberCount}`} ${n === 1 ? 'has' : 'have'} answered (${nameList(answered)}). ` +
        (pending === null ? 'Your turn!' : `${pending} to go!`)
  return `${groupName}, ${year} wrapped: ${status} ${PROMPTS.length} quick prompts, no app needed: ${inviteUrl}`
}
