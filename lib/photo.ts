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

type Photon = typeof import('@cf-wasm/photon')
let photonModule: Promise<Photon> | undefined

/**
 * Photon (Rust compiled to WebAssembly) decodes, resizes and re-encodes photos. It runs the same in Node.js and on the
 * Cloudflare Worker, where a native module like sharp can't load. It's loaded on first use, not at import, so a deploy
 * where it fails to load loses photo uploads only, never the rest of the app (lib/squad.ts imports this file).
 */
async function loadPhoton(): Promise<Photon> {
  photonModule ??= import('@cf-wasm/photon')
  try {
    return await photonModule
  } catch (err) {
    photonModule = undefined
    console.error('Photon failed to load:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error')
    throw new PhotoError('Photos can’t be added right now. Remove the photo and send your answers without it.', 503)
  }
}

/**
 * 8 megapixels. The friend form uploads ~1 MP, so this only bounds other clients: decoding needs memory in
 * proportion (4 bytes a pixel, in WebAssembly memory that never shrinks, inside a Worker's 128 MB), so larger
 * headers are refused before decoding.
 */
export const PHOTO_MAX_PIXELS = 8_000_000
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

type Format = 'jpeg' | 'png' | 'webp'

/** JPEG, PNG or WebP by their magic bytes. Everything else (SVG, GIF, TIFF, PDF…) never reaches a decoder. */
function formatOf(bytes: Buffer): Format | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) return 'png'
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

type Header = { width: number; height: number; orientation: number }

/**
 * The image's size, read from its header without decoding a pixel, and (JPEG only) its EXIF orientation, 1 to 8.
 * Null when the header can't be read.
 */
export function readHeader(bytes: Buffer, format: Format): Header | null {
  try {
    if (format === 'png') {
      if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), orientation: 1 }
    }
    if (format === 'webp') return webpHeader(bytes)
    return jpegHeader(bytes)
  } catch {
    // A read past the end: a truncated header.
    return null
  }
}

function webpHeader(bytes: Buffer): Header | null {
  const chunk = bytes.toString('latin1', 12, 16)
  if (chunk === 'VP8X') {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1, orientation: 1 }
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, orientation: 1 }
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, orientation: 1 }
  }
  return null
}

// Start-of-frame markers carry the size: C0–CF except DHT (C4), JPG (C8) and DAC (CC).
const isStartOfFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

function jpegHeader(bytes: Buffer): Header | null {
  let orientation = 1
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    // Fill bytes, and markers without a length.
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // end of image, or the pixels, before any frame header
    const length = bytes.readUInt16BE(at + 2)
    if (length < 2) return null
    if (marker === 0xe1 && bytes.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
      orientation = exifOrientation(bytes.subarray(at + 10, at + 2 + length)) ?? orientation
    }
    if (isStartOfFrame(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7), orientation }
    }
    at += 2 + length
  }
  return null
}

/** The Orientation tag (0x0112) of IFD0 in a TIFF block, if it holds a valid value. */
function exifOrientation(tiff: Buffer): number | null {
  const order = tiff.toString('latin1', 0, 2)
  if (order !== 'II' && order !== 'MM') return null
  const u16 = (at: number) => (order === 'II' ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
  const u32 = (at: number) => (order === 'II' ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
  const ifd = u32(4)
  const entries = u16(ifd)
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/**
 * Applies an EXIF orientation to RGBA pixels and puts transparency on white, in one pass. Returns the upright
 * pixels and their size. Orientations 5–8 swap width and height.
 */
export function uprightOnWhite(src: Uint8Array, width: number, height: number, orientation: number) {
  const swap = orientation >= 5
  const outWidth = swap ? height : width
  const outHeight = swap ? width : height
  const out = new Uint8Array(outWidth * outHeight * 4)
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      // Where this output pixel comes from in the stored (sideways) image.
      let sx: number, sy: number
      switch (orientation) {
        case 2: sx = width - 1 - x; sy = y; break
        case 3: sx = width - 1 - x; sy = height - 1 - y; break
        case 4: sx = x; sy = height - 1 - y; break
        case 5: sx = y; sy = x; break
        case 6: sx = y; sy = height - 1 - x; break
        case 7: sx = width - 1 - y; sy = height - 1 - x; break
        case 8: sx = width - 1 - y; sy = x; break
        default: sx = x; sy = y
      }
      const from = (sy * width + sx) * 4
      const to = (y * outWidth + x) * 4
      const alpha = src[from + 3] / 255
      out[to] = Math.round(src[from] * alpha + 255 * (1 - alpha))
      out[to + 1] = Math.round(src[from + 1] * alpha + 255 * (1 - alpha))
      out[to + 2] = Math.round(src[from + 2] * alpha + 255 * (1 - alpha))
      out[to + 3] = 255
    }
  }
  return { pixels: out, width: outWidth, height: outHeight }
}

/**
 * Re-encodes an uploaded photo for storage: upright (EXIF orientation applied), at most
 * LIMITS.photoMaxSide px a side, transparency on white, as a JPEG with every piece of metadata
 * (EXIF, GPS location, camera) dropped: only decoded pixels are encoded again. What's stored is always a plain JPEG
 * the slide renderer can draw.
 */
export async function normalizePhoto(bytes: Buffer): Promise<Buffer> {
  const format = formatOf(bytes)
  if (!format) throw new PhotoError('Photos can be JPEG, PNG or WebP.')
  const photon = await loadPhoton()
  // The size check happens before any pixel is decoded.
  const header = readHeader(bytes, format)
  if (!header || !header.width || !header.height) throw unreadable()
  if (header.width * header.height > PHOTO_MAX_PIXELS) {
    throw new PhotoError('That photo is too large. Try a smaller one or a screenshot of it.')
  }
  // Photon's images live in WebAssembly memory, which JavaScript's garbage collector doesn't free.
  const owned: { free(): void }[] = []
  try {
    let image: InstanceType<Photon['PhotonImage']>
    try {
      image = photon.PhotonImage.new_from_byteslice(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    } catch {
      throw unreadable()
    }
    owned.push(image)
    const width = image.get_width()
    const height = image.get_height()
    if (!width || !height || width * height > PHOTO_MAX_PIXELS) throw unreadable()
    const scale = Math.min(1, LIMITS.photoMaxSide / Math.max(width, height))
    if (scale < 1) {
      image = photon.resize(image, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), photon.SamplingFilter.Lanczos3)
      owned.push(image)
    }
    const upright = uprightOnWhite(image.get_raw_pixels(), image.get_width(), image.get_height(), header.orientation)
    const out = new photon.PhotonImage(upright.pixels, upright.width, upright.height)
    owned.push(out)
    return Buffer.from(out.get_bytes_jpeg(JPEG_QUALITY))
  } finally {
    for (const image of owned) image.free()
  }
}
