import { crc32 } from 'node:zlib'
import { ImageResponse } from 'next/og'
import type { ReactElement } from 'react'

/** Story format (Instagram, TikTok, WhatsApp status). */
export const SLIDE_WIDTH = 1080
export const SLIDE_HEIGHT = 1920

/** PNG tEXt keyword on free (locked) slides, so even a downloaded file says it's a preview. */
export const WATERMARK_KEYWORD = 'squadwrap:watermark'
export const WATERMARK_VALUE = 'preview'
/** The same flag as a response header, for clients that don't read PNG chunks. */
export const WATERMARK_HEADER = 'x-squadwrap-watermark'

export type Slide = {
  groupName: string
  year: number
  displayName: string
  title: string
  citation: string
  /** The friend's photo as stored: a normalized JPEG (lib/photo.ts), or null. */
  photo: Buffer | null
  /** Locked (unpaid) groups get a visible "PREVIEW" watermark and the PNG flag. */
  watermark: boolean
  /** Where the "make yours" line sends people, e.g. the site's host name. */
  credit: string
}

const INK = '#f4f0ff'
const MUTED = '#a99cc8'
const GREEN = '#1ed760'
const GOLD = '#ffd84d'
const NIGHT = '#120d1f'
const PHOTO_SIZE = 480
const RING = 12
// Story apps draw their own UI over roughly the top and bottom 200 px, so text stays clear of both.
const SAFE_TOP = 220
const SAFE_BOTTOM = 200

// The bundled font has no emoji, and next/og would fetch each one from a CDN while rendering, failing the
// whole slide if that fetch fails. Slides leave them out instead: pictographs, skin tones, flags, keycap
// marks, variation selectors, the zero-width joiner and tag characters.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{200D}\u{20E3}\u{FE0E}\u{FE0F}\u{E0020}-\u{E007F}]/gu

/**
 * The host the "make yours" line points to. On Vercel that's the project's production domain (a system env
 * var, set on preview deploys too), so a slide made on a preview URL still sends people to the real site.
 */
export function creditHost(requestUrl: string, env: Record<string, string | undefined> = process.env): string {
  return env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || new URL(requestUrl).host
}

/** Text as it is drawn on a slide: no emoji, single spaces. */
export function slideText(text: string): string {
  return text.replace(PICTOGRAPHS, '').replace(/\s+/g, ' ').trim()
}

/** Bigger type for short text, smaller for long, so the longest allowed title and citation still fit. */
function fontSize(text: string, steps: [maxLength: number, size: number][], smallest: number): number {
  return steps.find(([maxLength]) => text.length <= maxLength)?.[1] ?? smallest
}

/** The slide as a satori element tree (flexbox only; every element with children is display: flex). */
export function slideElement(slide: Slide, photoSrc: string | null): ReactElement {
  const name = slideText(slide.displayName)
  const title = slideText(slide.title)
  const citation = slideText(slide.citation)
  const initial = Array.from(name)[0]?.toLocaleUpperCase() ?? '?'
  // Near the length limits (80-char title, 300-char citation) a smaller photo keeps the credit on the slide.
  const photoSize = title.length + citation.length > 260 ? 400 : PHOTO_SIZE
  // Content keeps its size; only the spacers give way.
  const fixed = { display: 'flex', flexShrink: 0 } as const

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: `${SAFE_TOP}px 90px 0`,
        backgroundColor: NIGHT,
        backgroundImage: 'linear-gradient(165deg, #2c1460 0%, #120d1f 55%, #0b3325 100%)',
        color: INK,
        textAlign: 'center',
      }}
    >
      <div style={{ ...fixed, fontSize: 34, letterSpacing: 6, color: MUTED, textTransform: 'uppercase' }}>
        {slideText(slide.groupName)}
      </div>
      <div style={{ ...fixed, fontSize: 44, letterSpacing: 4, color: GREEN, marginTop: 8 }}>{`${slide.year} wrapped`}</div>

      <div style={{ ...fixed, marginTop: 56, padding: RING, borderRadius: photoSize, backgroundColor: GOLD }}>
        {photoSrc ? (
          <img
            src={photoSrc}
            width={photoSize}
            height={photoSize}
            style={{ width: photoSize, height: photoSize, borderRadius: photoSize / 2, objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: photoSize,
              height: photoSize,
              borderRadius: photoSize / 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: NIGHT,
              color: GOLD,
              fontSize: photoSize / 2,
            }}
          >
            {initial}
          </div>
        )}
      </div>

      <div style={{ ...fixed, fontSize: fontSize(name, [[18, 64]], 48), marginTop: 48, lineHeight: 1.15 }}>{name}</div>
      <div style={{ ...fixed, fontSize: 30, letterSpacing: 5, color: MUTED, marginTop: 36, textTransform: 'uppercase' }}>
        takes home
      </div>
      <div style={{ ...fixed, fontSize: fontSize(title, [[22, 92], [44, 74]], 60), color: GOLD, marginTop: 14, lineHeight: 1.1 }}>
        {title}
      </div>
      <div style={{ ...fixed, fontSize: fontSize(citation, [[140, 46], [220, 40]], 35), marginTop: 36, lineHeight: 1.35 }}>
        {citation}
      </div>

      {/* The credit sits SAFE_BOTTOM above the edge, and only moves lower when the text needs the room. */}
      <div style={{ display: 'flex', flexGrow: 1, flexShrink: 0, minHeight: 40 }} />
      <div style={{ ...fixed, fontSize: 32, color: MUTED }}>{`Make yours at ${slide.credit}`}</div>
      <div style={{ display: 'flex', flexShrink: 1, height: SAFE_BOTTOM }} />

      {slide.watermark && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-around',
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{ display: 'flex', fontSize: 170, letterSpacing: 18, color: 'rgba(255, 255, 255, 0.13)', transform: 'rotate(-30deg)' }}
            >
              PREVIEW
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

async function rasterize(element: ReactElement): Promise<Uint8Array<ArrayBuffer>> {
  const res = new ImageResponse(element, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * The slide as a 1080x1920 PNG. A stored photo that can't be drawn never costs the friend their slide:
 * it is rendered again without the photo. Locked slides carry the watermark flag as a PNG tEXt chunk.
 */
export async function renderSlide(slide: Slide): Promise<Uint8Array<ArrayBuffer>> {
  const photoSrc = slide.photo ? `data:image/jpeg;base64,${slide.photo.toString('base64')}` : null
  let png: Uint8Array<ArrayBuffer>
  try {
    png = await rasterize(slideElement(slide, photoSrc))
  } catch (err) {
    if (!photoSrc) throw err
    console.warn('Slide photo could not be drawn, rendering without it:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error')
    png = await rasterize(slideElement(slide, null))
  }
  return slide.watermark ? withPngText(png, WATERMARK_KEYWORD, WATERMARK_VALUE) : png
}

/**
 * The HTTP response for a slide, the same from the organizer's link and the yearbook's: a PNG, never stored by
 * any cache (the URL is a private key and the picture may hold a friend's photo), and the watermark header when locked.
 */
export async function slideResponse(slide: Omit<Slide, 'credit'>, requestUrl: string): Promise<Response> {
  const png = await renderSlide({ ...slide, credit: creditHost(requestUrl) })
  const headers = new Headers({ 'content-type': 'image/png', 'cache-control': 'private, no-store' })
  if (slide.watermark) headers.set(WATERMARK_HEADER, WATERMARK_VALUE)
  return new Response(png, { headers })
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Signature, then the IHDR chunk: length (4) + type (4) + data (13) + CRC (4). */
const IHDR_END = 8 + 4 + 4 + 13 + 4

/** A copy of `png` with a tEXt chunk (Latin-1 keyword and text) right after its header chunk. */
export function withPngText(png: Uint8Array, keyword: string, text: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  if (bytes.length < IHDR_END || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('withPngText: input is not a PNG')
  }
  const data = Buffer.from(`${keyword}\0${text}`, 'latin1')
  const chunk = Buffer.alloc(4 + 4 + data.length + 4)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write('tEXt', 4, 'latin1')
  data.copy(chunk, 8)
  // The CRC covers the chunk type and data.
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return new Uint8Array(Buffer.concat([bytes.subarray(0, IHDR_END), chunk, bytes.subarray(IHDR_END)]))
}
