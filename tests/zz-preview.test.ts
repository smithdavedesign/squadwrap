// Opt-in visual check of the slide design: nothing here asserts on looks, it writes PNGs for a person to open.
//   SLIDE_PREVIEW_DIR=.data/preview npx vitest run tests/zz-preview.test.ts
// Skipped in `npm test`. `.data/` is gitignored.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { it } from 'vitest'
import { LIMITS } from '../lib/prompts'
import { CITATION_MAX, TITLE_MAX } from '../lib/model'
import { renderSlide, type Slide } from '../lib/slide'

const dir = process.env.SLIDE_PREVIEW_DIR

const base: Slide = {
  groupName: 'Flat 4B',
  year: 2026,
  displayName: 'Ana',
  title: 'The Human Snooze Button',
  citation: 'Cancelled brunch four times for a sad cat. Still the first to RSVP next time, and nobody believes her.',
  photo: null,
  watermark: true,
  credit: 'squadwrap.vercel.app',
}

/** `word` repeated up to exactly `length` characters. */
const fill = (length: number, word: string) => Array.from({ length }, () => word).join(' ').slice(0, length)

it.skipIf(!dir)('writes sample slides to SLIDE_PREVIEW_DIR', async () => {
  const out = dir!
  await mkdir(out, { recursive: true })
  const photo = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#d06030' } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="900" height="700"><circle cx="450" cy="300" r="200" fill="#ffe0b0"/><rect y="520" width="900" height="180" fill="#305080"/></svg>',
        ),
      },
    ])
    .jpeg()
    .toBuffer()

  const samples: Record<string, Slide> = {
    'locked-photo': { ...base, photo },
    'unlocked-initial': { ...base, watermark: false },
    'longest-texts': {
      ...base,
      photo,
      groupName: fill(LIMITS.groupName, 'Wednesday'),
      displayName: fill(LIMITS.displayName, 'Wolfgang'),
      title: fill(TITLE_MAX, 'Mammoth'),
      citation: fill(CITATION_MAX, 'Somewhere'),
    },
    emoji: { ...base, displayName: 'Sam 🍕', title: '👑 Queen of Brunch 🥂' },
  }
  for (const [name, slide] of Object.entries(samples)) {
    await writeFile(join(out, `${name}.png`), await renderSlide(slide))
  }
})
