import { LIMITS } from './prompts'

/**
 * The photo can't be used. The message is safe to show to the friend.
 * status 400: the upload is bad. 503: this server can't process photos right now.
 */
export class PhotoError extends Error {
  override name = 'PhotoError'
  constructor(
    message: string,
    readonly status: 400 | 503 = 400,
  ) {
    super(message)
  }
}

type Sharp = typeof import('sharp').default
let sharpModule: Promise<Sharp> | undefined

/**
 * sharp is a native module (libvips). It's loaded on first use, not at import, so a deploy where it fails
 * to load loses photo uploads only, never the rest of the app (lib/squad.ts imports this file).
 */
async function loadSharp(): Promise<Sharp> {
  sharpModule ??= import('sharp').then((m) => m.default)
  try {
    return await sharpModule
  } catch (err) {
    sharpModule = undefined
    console.error('sharp failed to load:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error')
    throw new PhotoError('Photos can’t be added right now. Remove the photo and send your answers without it.', 503)
  }
}

/**
 * 12 megapixels, a phone camera original. The friend form uploads ~1 MP, so this only bounds other clients:
 * decoding (a progressive JPEG especially) needs memory in proportion. Larger headers are refused before decoding.
 */
export const PHOTO_MAX_PIXELS = 12_000_000
const JPEG_QUALITY = 82

const DATA_URL_PREFIX = /^data:image\/[a-z0-9.+-]{1,40};base64,/i
const MAX_PREFIX_LENGTH = 'data:image/;base64,'.length + 40
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const MAX_BASE64_LENGTH = Math.ceil(LIMITS.photoBytes / 3) * 4

const unreadable = () => new PhotoError('That photo could not be read. Try a JPEG or PNG.')

/**
 * The submission's optional `photo` field: a base64 image data URL (what the friend form sends) or nothing.
 * Returns the raw bytes; nothing is decoded as an image yet.
 */
export function decodePhotoField(value: unknown): Buffer | null {
  if (value === undefined || value === null || value === '') return null
  const notDataUrl = () => new PhotoError('The photo must be sent as a base64 image data URL.')
  if (typeof value !== 'string') throw notDataUrl()
  const tooBig = () => new PhotoError(`That photo is too big. Photos can be up to ${LIMITS.photoBytes / 1_000_000} MB.`)
  // Size first, so an oversized string is never scanned.
  if (value.length > MAX_BASE64_LENGTH + MAX_PREFIX_LENGTH) throw tooBig()
  const prefix = DATA_URL_PREFIX.exec(value)
  if (!prefix) throw notDataUrl()
  const base64 = value.slice(prefix[0].length)
  if (base64.length > MAX_BASE64_LENGTH) throw tooBig()
  if (!BASE64.test(base64)) throw notDataUrl()
  return Buffer.from(base64, 'base64')
}

/** JPEG, PNG or WebP by their magic bytes. Everything else (SVG, GIF, TIFF, PDF…) never reaches a decoder. */
function isAcceptedFormat(bytes: Buffer): boolean {
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a
  const webp = bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP'
  return jpeg || png || webp
}

/**
 * Re-encodes an uploaded photo for storage: upright (EXIF orientation applied), at most
 * LIMITS.photoMaxSide px a side, transparency on white, as a JPEG with every piece of metadata
 * (EXIF, GPS location, camera) dropped. What's stored is always a plain JPEG the slide renderer can draw.
 */
export async function normalizePhoto(bytes: Buffer): Promise<Buffer> {
  if (!isAcceptedFormat(bytes)) throw new PhotoError('Photos can be JPEG, PNG or WebP.')
  const sharp = await loadSharp()
  let width: number, height: number
  try {
    // Reads the header only; the size check below happens before any pixel is decoded.
    ;({ width, height } = await sharp(bytes, { limitInputPixels: false }).metadata())
  } catch {
    throw unreadable()
  }
  if (!width || !height || width * height > PHOTO_MAX_PIXELS) {
    throw new PhotoError('That photo is too large. Try a smaller one or a screenshot of it.')
  }
  try {
    return await sharp(bytes, { limitInputPixels: PHOTO_MAX_PIXELS, autoOrient: true })
      .resize(LIMITS.photoMaxSide, LIMITS.photoMaxSide, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  } catch {
    throw unreadable()
  }
}
