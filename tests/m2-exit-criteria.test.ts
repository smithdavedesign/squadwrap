// One test (or more) per M2 exit criterion in ROADMAP.md.
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../lib/db'
import { getBinary, groupWithAwards, photoDataUrl, setUnlocked, slideUrl, testDb } from './helpers'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width and height straight from the PNG's IHDR chunk, independent of any image library. */
function ihdrSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  expect(png.toString('latin1', 12, 16)).toBe('IHDR')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** Every tEXt chunk of a PNG, as read by a real decoder (libvips/libpng via sharp). */
async function pngText(png: Buffer): Promise<Record<string, string>> {
  const { comments = [] } = await sharp(png).metadata()
  return Object.fromEntries(comments.map((c) => [c.keyword, c.text]))
}

let db: Db
beforeAll(async () => {
  db = await testDb()
})

describe('M2 exit criteria', () => {
  it('EC1: GET /groups/:id/awards/:name.png returns image/png with width 1080 and height 1920', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])

    const res = await getBinary(slideUrl(group.id, 'Ana'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(ihdrSize(res.bytes)).toEqual({ width: 1080, height: 1920 })
    // The whole file decodes, not just the header.
    const decoded = await sharp(res.bytes).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 1080, height: 1920 })
  })

  it('EC2: a submission with a photo yields a PNG larger than the same award without a photo', async () => {
    // Two groups with the same name, year, friends, answers and award text; only Ana's photo differs.
    const photo = await photoDataUrl()
    const withPhoto = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'], { Ana: photo })
    const withoutPhoto = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])

    const a = await getBinary(slideUrl(withPhoto.id, 'Ana'))
    const b = await getBinary(slideUrl(withoutPhoto.id, 'Ana'))
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(ihdrSize(a.bytes)).toEqual({ width: 1080, height: 1920 })
    expect(a.bytes.length).toBeGreaterThan(b.bytes.length)
  })

  it('EC3: PNGs for a locked group carry the watermark flag', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])

    // New groups start locked (the M4 payment unlocks them).
    const res = await getBinary(slideUrl(group.id, 'Ben'))
    expect(res.status).toBe(200)
    expect(await pngText(res.bytes)).toMatchObject({ 'squadwrap:watermark': 'preview' })
    expect(res.headers.get('x-squadwrap-watermark')).toBe('preview')
  })

  it('EC3: PNGs for an unlocked group do not carry the watermark flag', async () => {
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    await setUnlocked(db, group.id)

    const res = await getBinary(slideUrl(group.id, 'Ben'))
    expect(res.status).toBe(200)
    expect(ihdrSize(res.bytes)).toEqual({ width: 1080, height: 1920 })
    expect(await pngText(res.bytes)).not.toHaveProperty('squadwrap:watermark')
    expect(res.headers.has('x-squadwrap-watermark')).toBe(false)
  })
})
