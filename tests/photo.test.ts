// Optional friend photos (M2): decoding the upload, normalizing it, and storing it with the submission.
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../lib/db'
import { PHOTO_MAX_PIXELS, PhotoError, decodePhotoField, normalizePhoto, readHeader } from '../lib/photo'
import { LIMITS } from '../lib/prompts'
import {
  answersFor,
  api,
  awardsJson,
  createGroup,
  photoDataUrl,
  storedPhoto,
  stubModel,
  submissionBody,
  submit,
  testDb,
  useDeps,
} from './helpers'

const bytesOf = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`

type Background = string | { r: number; g: number; b: number; alpha: number }

function solid(width: number, height: number, channels: 3 | 4 = 3, background: Background = '#3366cc') {
  return sharp({ create: { width, height, channels, background } })
}

/** A real PNG whose header claims `width` x `height`: the shape of a decompression bomb. */
async function pngClaiming(width: number, height: number): Promise<Buffer> {
  const png = await solid(1, 1).png().toBuffer()
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  // Re-sign IHDR (type + data = bytes 12..29) so the header itself is valid.
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29)
  return png
}

describe('decodePhotoField', () => {
  it.each([undefined, null, ''])('treats %j as "no photo"', (value) => {
    expect(decodePhotoField(value)).toBeNull()
  })

  it('decodes a base64 image data URL', async () => {
    const url = await photoDataUrl({ width: 8, height: 8 })
    expect(decodePhotoField(url)?.equals(bytesOf(url))).toBe(true)
  })

  it.each([
    ['a number', 42],
    ['an object', { src: 'x' }],
    ['plain text', 'my-photo.jpg'],
    ['a URL', 'https://example.com/me.jpg'],
    ['a non-image data URL', 'data:text/plain;base64,aGVsbG8='],
    ['a data URL that is not base64', 'data:image/jpeg,hello'],
    ['broken base64', 'data:image/jpeg;base64,***not-base64***'],
    ['an empty payload', 'data:image/jpeg;base64,'],
  ])('rejects %s', (_label, value) => {
    expect(() => decodePhotoField(value)).toThrow(PhotoError)
  })

  it(`rejects a photo over ${LIMITS.photoBytes} bytes before decoding it`, () => {
    const tooBig = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(LIMITS.photoBytes / 3) * 4 + 4)
    expect(() => decodePhotoField(tooBig)).toThrow(/too big/i)
  })

  it('rejects an oversized string by its length alone, whatever it contains', () => {
    expect(() => decodePhotoField('x'.repeat(Math.ceil(LIMITS.photoBytes / 3) * 4 + 100))).toThrow(/too big/i)
  })
})

describe('normalizePhoto', () => {
  it(`shrinks a large photo to at most ${LIMITS.photoMaxSide} px a side and re-encodes it as JPEG`, async () => {
    const out = await normalizePhoto(await solid(2000, 1500).png().toBuffer())
    const meta = await sharp(out).metadata()
    expect(meta).toMatchObject({ format: 'jpeg', width: LIMITS.photoMaxSide, height: Math.round((LIMITS.photoMaxSide * 3) / 4) })
  })

  it('never enlarges a small photo', async () => {
    const out = await normalizePhoto(await solid(400, 300).jpeg().toBuffer())
    expect(await sharp(out).metadata()).toMatchObject({ format: 'jpeg', width: 400, height: 300 })
  })

  it('turns the photo upright and drops EXIF metadata (location, camera, orientation)', async () => {
    const sideways = await solid(400, 200)
      .jpeg()
      .withExif({ IFD0: { ImageDescription: 'Taken at home' } })
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const before = await sharp(sideways).metadata()
    expect(before.orientation).toBe(6)
    expect(before.exif).toBeDefined()

    const after = await sharp(await normalizePhoto(sideways)).metadata()
    expect(after).toMatchObject({ width: 200, height: 400 })
    expect(after.orientation).toBeUndefined()
    expect(after.exif).toBeUndefined()
  })

  // Four coloured quadrants, so every rotation and mirror lands each colour in a different corner.
  async function quadrants(orientation: number): Promise<Buffer> {
    const [w, h] = [60, 30]
    const raw = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const colour = y < h / 2 ? (x < w / 2 ? [255, 0, 0] : [0, 255, 0]) : x < w / 2 ? [0, 0, 255] : [255, 255, 0]
        raw.set(colour, (y * w + x) * 3)
      }
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation }).toBuffer()
  }

  const corners = async (jpeg: Buffer) => {
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)).map((v) => (v > 127 ? 1 : 0))
    const [r, b] = [info.width - 3, info.height - 3]
    return { width: info.width, height: info.height, corners: [at(2, 2), at(r, 2), at(2, b), at(r, b)] }
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('turns EXIF orientation %i upright, exactly as sharp does', async (orientation) => {
    const photo = await quadrants(orientation)
    const expected = await corners(await sharp(photo, { autoOrient: true }).jpeg().toBuffer())
    expect(await corners(await normalizePhoto(photo))).toEqual(expected)
  })

  it.each(['jpeg', 'png', 'webp'] as const)('reads a %s header’s size without decoding it', async (format) => {
    for (const [width, height] of [[1, 1], [640, 480], [123, 4567]]) {
      const bytes = await solid(width, height).toFormat(format).toBuffer()
      expect(readHeader(bytes, format)).toMatchObject({ width, height })
    }
    const lossless = await solid(300, 200, 4, { r: 1, g: 2, b: 3, alpha: 0.5 }).webp({ lossless: true }).toBuffer()
    expect(readHeader(lossless, 'webp')).toMatchObject({ width: 300, height: 200 })
  })

  it('accepts PNG and WebP', async () => {
    for (const format of ['png', 'webp'] as const) {
      const out = await normalizePhoto(bytesOf(await photoDataUrl({ width: 64, height: 48, format })))
      expect((await sharp(out).metadata()).format).toBe('jpeg')
    }
  })

  it('puts a transparent PNG on white, not black', async () => {
    const transparent = await solid(16, 16, 4, { r: 0, g: 0, b: 0, alpha: 0 }).png().toBuffer()
    const pixels = await sharp(await normalizePhoto(transparent)).raw().toBuffer()
    expect(Math.min(pixels[0], pixels[1], pixels[2])).toBeGreaterThan(245)
  })

  it.each([
    ['a GIF', () => solid(16, 16).gif().toBuffer()],
    ['an SVG', async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')],
    ['text', async () => Buffer.from('definitely not a photo')],
    ['a broken JPEG', async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])],
  ])('rejects %s', async (_label, make) => {
    await expect(normalizePhoto(await make())).rejects.toThrow(PhotoError)
  })

  it(`rejects an image whose header claims more than ${PHOTO_MAX_PIXELS} pixels, without decoding it`, async () => {
    // 100 MP: over our cap, under sharp's own default limit (268 MP), so it's our check that stops it.
    const bomb = await pngClaiming(10_000, 10_000)
    expect(await sharp(bomb).metadata()).toMatchObject({ width: 10_000, height: 10_000 })
    await expect(normalizePhoto(bomb)).rejects.toThrow(/too large/i)
  })

  it('caps photos well below a phone camera original (the friend form uploads ~1 MP)', async () => {
    expect(PHOTO_MAX_PIXELS).toBeLessThanOrEqual(12_000_000)
    const justOver = await pngClaiming(4000, Math.floor(PHOTO_MAX_PIXELS / 4000) + 1)
    await expect(normalizePhoto(justOver)).rejects.toThrow(/too large/i)
  })
})

describe('submitting with a photo', () => {
  let db: Db
  beforeAll(async () => {
    db = await testDb()
  })
  beforeEach(() => {
    useDeps(db, stubModel(awardsJson(['Ana', 'Ben', 'Cat'])))
  })

  it('stores the normalized photo with the submission and does not echo it back', async () => {
    const group = await createGroup()
    const big = dataUrl('image/png', await solid(2000, 1500).png().toBuffer())
    const res = await submit(group.id, 'Ana', answersFor('Ana'), big)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ displayName: 'Ana' })

    const photo = await storedPhoto(db, group.id, 'Ana')
    expect(photo).not.toBeNull()
    expect(await sharp(photo!).metadata()).toMatchObject({ format: 'jpeg', width: LIMITS.photoMaxSide })
  })

  it('accepts a photo through the friend invite link', async () => {
    const group = await createGroup()
    const res = await api(
      'POST',
      `/join/${group.inviteToken}/submissions`,
      submissionBody('Ben', answersFor('Ben'), await photoDataUrl({ width: 32, height: 32 })),
    )
    expect(res.status).toBe(201)
    expect(await storedPhoto(db, group.id, 'Ben')).not.toBeNull()
  })

  it('stores no photo when none is sent', async () => {
    const group = await createGroup()
    expect((await submit(group.id, 'Cat')).status).toBe(201)
    expect(await storedPhoto(db, group.id, 'Cat')).toBeNull()
  })

  it.each([
    ['not an image', 'data:image/jpeg;base64,' + Buffer.from('hello there').toString('base64')],
    ['not a data URL', 'https://example.com/me.jpg'],
    ['too big', 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(LIMITS.photoBytes / 3) * 4 + 4)],
  ])('rejects a photo that is %s with 400 and stores nothing', async (_label, photo) => {
    const group = await createGroup()
    const res = await submit(group.id, 'Ana', answersFor('Ana'), photo)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    const { rows } = await db.query('SELECT 1 FROM submissions WHERE group_id = $1', [group.id])
    expect(rows).toHaveLength(0)
  })

  // A photo that would fail decoding (JPEG magic, garbage after it): if the answer is the 404/409 rather than
  // a 400, the cheap checks ran first and no image work was spent on a submission that can't be stored.
  const undecodable = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64')

  it('checks the group and name before decoding a photo: unknown group → 404', async () => {
    expect((await submit('no-such-group-000000000', 'Ana', answersFor('Ana'), undecodable)).status).toBe(404)
  })

  it('checks the group and name before decoding a photo: reused name → 409 duplicate_name', async () => {
    const group = await createGroup()
    expect((await submit(group.id, 'Ana')).status).toBe(201)
    const res = await submit(group.id, ' ANA ', answersFor('Ana'), undecodable)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('duplicate_name')
  })

  it('checks the group and name before decoding a photo: full group → 409 group_full', async () => {
    const group = await createGroup()
    for (let i = 1; i <= LIMITS.maxMembers; i++) expect((await submit(group.id, `Friend ${i}`)).status).toBe(201)
    const res = await submit(group.id, 'Late Larry', answersFor('Larry'), undecodable)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('group_full')
  })

  it('still answers 409 for a reused name when a photo is attached, keeping the first photo', async () => {
    const group = await createGroup()
    const first = await photoDataUrl({ width: 40, height: 30 })
    expect((await submit(group.id, 'Ana', answersFor('Ana'), first)).status).toBe(201)
    const stored = await storedPhoto(db, group.id, 'Ana')

    const dup = await submit(group.id, 'ana', answersFor('Ana'), await photoDataUrl({ width: 50, height: 50 }))
    expect(dup.status).toBe(409)
    expect((await storedPhoto(db, group.id, 'Ana'))?.equals(stored!)).toBe(true)
  })
})
