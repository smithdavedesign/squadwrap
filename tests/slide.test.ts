// Story slides (M2) beyond the exit criteria: the slide content, the PNG flag, rendering fallbacks and the route's edges.
import { ImageResponse } from 'next/og'
import { createElement, isValidElement, type ReactNode } from 'react'
import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '../lib/db'
import { CITATION_MAX, TITLE_MAX } from '../lib/model'
import { LIMITS } from '../lib/prompts'
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  WATERMARK_KEYWORD,
  creditHost,
  renderSlide,
  slideElement,
  slideText,
  withPngText,
  type Slide,
} from '../lib/slide'
import { getDashboard, slidePath } from '../lib/squad'
import { getBinary, groupWithAwards, photoDataUrl, setUnlocked, slideUrl, testDb } from './helpers'

const baseSlide: Slide = {
  groupName: 'Flat 4B',
  year: 2026,
  displayName: 'Ana',
  title: 'The Human Snooze Button',
  citation: 'Cancelled brunch four times for a sad cat. Still the first to RSVP next time.',
  photo: null,
  watermark: true,
  credit: 'squadwrap.example',
}

/** All text and every element type in a slide's element tree. */
function walk(node: ReactNode, out = { text: [] as string[], types: [] as string[] }) {
  if (typeof node === 'string' || typeof node === 'number') out.text.push(String(node))
  else if (Array.isArray(node)) node.forEach((child) => walk(child, out))
  else if (isValidElement<{ children?: ReactNode }>(node)) {
    out.types.push(typeof node.type === 'string' ? node.type : 'component')
    walk(node.props.children, out)
  }
  return out
}
const textOf = (slide: Slide, photoSrc: string | null = null) => walk(slideElement(slide, photoSrc)).text.join(' ')

const comments = async (png: Uint8Array) =>
  Object.fromEntries(((await sharp(png).metadata()).comments ?? []).map((c) => [c.keyword, c.text]))

describe('slideElement', () => {
  it('shows the group, year, name, award title, citation and the "make yours" credit', () => {
    const text = textOf(baseSlide)
    for (const part of ['Flat 4B', '2026', 'Ana', baseSlide.title, baseSlide.citation, 'Make yours', 'squadwrap.example']) {
      expect(text).toContain(part)
    }
  })

  it('keeps the credit on unlocked slides and only draws the watermark on locked ones', () => {
    expect(textOf(baseSlide)).toContain('PREVIEW')
    const unlocked = textOf({ ...baseSlide, watermark: false })
    expect(unlocked).not.toContain('PREVIEW')
    expect(unlocked).toContain('Make yours')
  })

  it("uses the person's photo when there is one, and their initial otherwise", () => {
    const withPhoto = walk(slideElement(baseSlide, 'data:image/jpeg;base64,AAAA'))
    expect(withPhoto.types).toContain('img')
    const without = walk(slideElement({ ...baseSlide, displayName: 'zoë' }, null))
    expect(without.types).not.toContain('img')
    expect(without.text).toContain('Z')
  })
})

describe('slideText', () => {
  it.each([
    ['Sam 🍕', 'Sam'],
    ['👩‍👩‍👧 fam', 'fam'],
    ['🇩🇪 Hans', 'Hans'],
    ['Queen 👑🏽 of Brunch', 'Queen of Brunch'],
    ['Zoë & Łukasz', 'Zoë & Łukasz'],
    ['  lots   of   space ', 'lots of space'],
  ])('turns %j into %j', (input, expected) => {
    expect(slideText(input)).toBe(expected)
  })
})

describe('creditHost', () => {
  it("prefers the project's production domain, so preview deploys never print their own host on shared slides", () => {
    expect(creditHost('https://squadwrap-git-x-team.vercel.app/groups/a/awards/b.png', { VERCEL_PROJECT_PRODUCTION_URL: 'squadwrap.example' })).toBe(
      'squadwrap.example',
    )
  })

  it('falls back to the request host (local dev, other hosts)', () => {
    expect(creditHost('http://localhost:3000/groups/a/awards/b.png', {})).toBe('localhost:3000')
    expect(creditHost('http://localhost:3000/x', { VERCEL_PROJECT_PRODUCTION_URL: '  ' })).toBe('localhost:3000')
  })
})

describe('withPngText', () => {
  it('adds a tEXt chunk that a real PNG decoder reads, leaving the image intact', async () => {
    const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#123456' } }).png().toBuffer()
    const flagged = withPngText(png, WATERMARK_KEYWORD, 'preview')

    expect(await comments(flagged)).toEqual({ [WATERMARK_KEYWORD]: 'preview' })
    const a = await sharp(png).raw().toBuffer()
    const b = await sharp(Buffer.from(flagged)).raw().toBuffer()
    expect(b.equals(a)).toBe(true)
  })

  it('refuses input that is not a PNG', () => {
    expect(() => withPngText(Buffer.from('GIF89a not a png at all, padding padding'), 'k', 'v')).toThrow()
  })
})

describe('renderSlide', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Records every network request and fails it. satori loads its own WASM through fetch() on data: URLs, which pass. */
  function blockNetwork(): string[] {
    const realFetch = globalThis.fetch
    const requested: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith('data:')) return realFetch(input, init)
      requested.push(url)
      return Promise.reject(new Error('network is off in tests'))
    })
    return requested
  }

  it('renders emoji-laden text without reaching for the network (the emoji CDN is never fetched)', async () => {
    const requested = blockNetwork()
    const png = await renderSlide({ ...baseSlide, displayName: 'Sam 🍕', title: '👑 Queen of Brunch 🥂' })
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
    expect(requested).toEqual([])
  })

  it('still renders non-Latin text when Google Fonts is unreachable (glyphs left blank, slide intact)', async () => {
    // Accepted trade-off: for scripts the bundled font lacks, next/og asks Google Fonts for the glyphs.
    const requested = blockNetwork()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const png = await renderSlide({ ...baseSlide, displayName: '美咲', groupName: 'محمد و أصدقاؤه', title: 'Королева бранча' })
      expect(await sharp(png).metadata()).toMatchObject({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
      expect(requested.every((url) => url.startsWith('https://fonts.googleapis.com/'))).toBe(true)
    } finally {
      quiet.mockRestore()
    }
  })

  it('needs that: next/og fails the whole image when an emoji is left in and the CDN is unreachable', async () => {
    // Guards the test above, proving the spy sees the CDN request when emoji aren't stripped.
    const requested = blockNetwork()
    const res = new ImageResponse(createElement('div', { style: { display: 'flex' } }, 'Queen 🥂'), { width: 200, height: 100 })
    await expect(res.arrayBuffer()).rejects.toThrow()
    expect(requested.some((url) => url.startsWith('https://'))).toBe(true)
  })

  it('still renders the slide, without the photo, when a stored photo cannot be decoded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const png = await renderSlide({ ...baseSlide, photo: Buffer.from('this is not a jpeg at all') })
      expect(await sharp(png).metadata()).toMatchObject({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
      // The first attempt failed and the fallback (no photo) drew the slide.
      expect(warn).toHaveBeenCalledTimes(1)
      const withoutPhoto = await renderSlide(baseSlide)
      expect(Buffer.from(png).equals(Buffer.from(withoutPhoto))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  /** `word` repeated up to exactly `length` characters. */
  const fill = (length: number, word: string) => Array.from({ length }, () => word).join(' ').slice(0, length)

  /** The pixel rows where two same-size renders differ. */
  async function differingRows(a: Uint8Array, b: Uint8Array): Promise<number[]> {
    const [ra, rb] = await Promise.all([a, b].map((png) => sharp(png).raw().toBuffer({ resolveWithObject: true })))
    const rowBytes = ra.info.width * ra.info.channels
    const rows: number[] = []
    for (let y = 0; y < ra.info.height; y++) {
      const [start, end] = [y * rowBytes, (y + 1) * rowBytes]
      if (!ra.data.subarray(start, end).equals(rb.data.subarray(start, end))) rows.push(y)
    }
    return rows
  }

  it('draws the "make yours" credit clear of the bottom 200 px that story apps cover', async () => {
    const slide = { ...baseSlide, watermark: false }
    // Only the credit differs, so the differing rows are exactly where it is drawn.
    const rows = await differingRows(await renderSlide(slide), await renderSlide({ ...slide, credit: 'other.example' }))
    expect(rows.length).toBeGreaterThan(0)
    expect(Math.max(...rows)).toBeLessThan(SLIDE_HEIGHT - 200)
  })

  it('keeps the credit fully on the slide at the longest allowed group name, name, title and citation', async () => {
    const longest = {
      ...baseSlide,
      watermark: false,
      groupName: fill(LIMITS.groupName, 'Wednesday'),
      displayName: fill(LIMITS.displayName, 'Wolfgang'),
      title: fill(TITLE_MAX, 'Mammoth'),
      citation: fill(CITATION_MAX, 'Somewhere'),
    }
    const rows = await differingRows(await renderSlide(longest), await renderSlide({ ...longest, credit: 'other.example' }))
    expect(rows.length).toBeGreaterThan(0)
    expect(Math.max(...rows)).toBeLessThan(SLIDE_HEIGHT - 20)
  })

  it('draws a visible watermark on locked slides, not just the flag', async () => {
    const locked = await sharp(await renderSlide(baseSlide)).raw().toBuffer()
    const unlocked = await sharp(await renderSlide({ ...baseSlide, watermark: false })).raw().toBuffer()
    expect(locked.length).toBe(unlocked.length)
    expect(locked.equals(unlocked)).toBe(false)
  })
})

describe('GET /groups/:id/awards/:name.png', () => {
  let db: Db
  beforeAll(async () => {
    db = await testDb()
  })

  it('finds the award by name regardless of case', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const res = await getBinary(`/groups/${group.id}/awards/ana.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  it('serves names with spaces, dots, slashes and percent signs through slidePath', async () => {
    const names = ['Ana B.', 'Jo/Jo', '100% Cat', 'x.png']
    const group = await groupWithAwards(db, names)
    for (const name of names) {
      const path = slidePath(group.id, name)
      expect(path).toBe(slideUrl(group.id, name))
      expect((await getBinary(path)).status, name).toBe(200)
    }
  })

  it('is private and never cached by shared caches (the URL is the organizer key, and it holds a photo)', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: await photoDataUrl({ width: 32, height: 32 }) })
    const res = await getBinary(slideUrl(group.id, 'Ana'))
    expect(res.headers.get('cache-control')).toMatch(/private/)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
  })

  it('returns 404 for an unknown group', async () => {
    const res = await getBinary(slideUrl('no-such-group-000000000', 'Ana'))
    expect(res.status).toBe(404)
    expect(JSON.parse(res.bytes.toString()).error.code).toBe('group_not_found')
  })

  it('returns 404 for the invite token used in place of the group id', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const [row] = (await db.query<{ invite_token: string }>('SELECT invite_token FROM groups WHERE id = $1', [group.id])).rows
    expect((await getBinary(slideUrl(row.invite_token, 'Ana'))).status).toBe(404)
  })

  it('returns 404 for a name with no award', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const res = await getBinary(slideUrl(group.id, 'Dan'))
    expect(res.status).toBe(404)
    expect(JSON.parse(res.bytes.toString()).error.code).toBe('award_not_found')
  })

  it('returns 404 before the awards are made', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    await db.query('DELETE FROM awards WHERE group_id = $1', [group.id])
    expect((await getBinary(slideUrl(group.id, 'Ana'))).status).toBe(404)
  })

  it('returns 404 for anything but .png', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    for (const file of ['Ana', 'Ana.jpg', 'Ana.png.txt', '.png']) {
      expect((await getBinary(`/groups/${group.id}/awards/${encodeURIComponent(file)}`)).status, file).toBe(404)
    }
  })

  it('stops carrying the watermark flag as soon as the group is unlocked', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect(await comments((await getBinary(slideUrl(group.id, 'Cat'))).bytes)).toHaveProperty(WATERMARK_KEYWORD)
    await setUnlocked(db, group.id)
    expect(await comments((await getBinary(slideUrl(group.id, 'Cat'))).bytes)).not.toHaveProperty(WATERMARK_KEYWORD)
  })

  it('getDashboard tells the organizer page whether the group is unlocked', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    expect((await getDashboard(db, group.id))?.unlocked).toBe(false)
    await setUnlocked(db, group.id)
    expect((await getDashboard(db, group.id))?.unlocked).toBe(true)
  })
})
