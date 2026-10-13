// Shared by the friend form (client) and the server, so keep this file free of server imports.

export const PROMPTS = [
  { id: 'cancels', label: 'Who cancelled on plans the most this year, and what was the excuse?' },
  { id: 'lore', label: 'The group lore of the year: the story you’ll still be retelling in ten years.' },
  { id: 'mainCharacter', label: 'Your main-character moment of the year.' },
  { id: 'threeWords', label: 'This year, in three words.' },
  { id: 'secretAward', label: 'Which award do you secretly think you deserve?' },
] as const

export type PromptId = (typeof PROMPTS)[number]['id']
export type Answers = Record<PromptId, string>

export const LIMITS = {
  groupName: 60,
  displayName: 40,
  answer: 280,
  minYear: 2000,
  maxYear: 2100,
  minMembers: 3,
  maxMembers: 20,
  minSubmissionsToGenerate: 3,
  /** Largest photo upload accepted (decoded bytes); the friend form shrinks photos well below this first. */
  photoBytes: 3_000_000,
  /** Photos are stored at most this many pixels on their longest side (slides draw them in a 480 px circle). */
  photoMaxSide: 720,
  /** A yearbook report: what's wrong, and optionally how to reach the reporter. */
  reportReason: 1000,
  reportContact: 200,
  /**
   * Reports per group in any rolling hour, so one person can't flood the operator's queue. A window rather than a
   * total, so a flood can't block a real takedown request for more than an hour.
   */
  reportsPerGroupPerHour: 20,
  /** Every group, with all its answers, photos, awards and reports, is deleted this many days after it was made. */
  retentionDays: 30,
  /** No unlock is sold in a group's last days: it would be deleted almost as soon as it was paid for. */
  unlockCutoffDays: 2,
} as const

/**
 * The one thing for sale: every slide of one group without the watermark, paid once (Stripe Payment Link or
 * Checkout). $6, per REVENUE.md: below the ~€6 per-person chat wraps, since one payer covers the whole group.
 */
export const UNLOCK_PRICE = { cents: 600, currency: 'usd', label: '$6' } as const

const DAY_MS = 86_400_000

/**
 * When a group made at `createdAt` is deleted: on the UTC day of this moment, by that day's run of the cleanup job
 * (lib/cleanup.ts deletes by the same UTC day), so the date people are shown is the day it happens.
 */
export function deletesOn(createdAt: Date): Date {
  return new Date(createdAt.getTime() + LIMITS.retentionDays * DAY_MS)
}

/** True once a group is too close to its deletion to sell it an unlock. */
export function tooLateToUnlock(createdAt: Date, now: Date = new Date()): boolean {
  return deletesOn(createdAt).getTime() - now.getTime() < LIMITS.unlockCutoffDays * DAY_MS
}

/** A day as people read it, e.g. "December 28, 2026", in UTC so the server and every browser agree. */
export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/** C0/C1 control characters, which become spaces. */
function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
}

/**
 * Zero-width and bidi-control characters, which are dropped so two names can't look identical
 * while differing invisibly. The zero-width joiner (0x200d) stays because emoji sequences need it.
 */
function isInvisible(codePoint: number): boolean {
  return (
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2064) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  )
}

/** One tidy line of user or model text: no control/invisible characters, single spaces, trimmed. */
export function cleanLine(text: string): string {
  let out = ''
  for (const char of text.normalize('NFKC')) {
    const codePoint = char.codePointAt(0)!
    if (isInvisible(codePoint)) continue
    out += isControl(codePoint) ? ' ' : char
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Display names that differ only in case, spacing or invisible characters (every Unicode
 * default-ignorable code point, including the joiner and soft hyphen) belong to the same person.
 */
export function nameKey(displayName: string): string {
  return cleanLine(displayName).replace(/\p{Default_Ignorable_Code_Point}/gu, '').toLowerCase()
}
