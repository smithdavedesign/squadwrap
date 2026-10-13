import { createHash } from 'node:crypto'
import { getDb, handle } from '../../../../lib/api'
import { slideResponse } from '../../../../lib/slide'
import { AppError, getYearbookPhoto, getYearbookSlide } from '../../../../lib/squad'

// A slide render takes about a second, as on the organizer's slide route.
export const maxDuration = 30

type Ctx = { params: Promise<{ token: string; file: string }> }

/**
 * Files behind the yearbook link (name URL-encoded, matched ignoring case and spacing):
 *   GET /y/:token/:name.png → the friend's 1080x1920 story slide, exactly as the organizer's route renders it
 *   GET /y/:token/:name.jpg → the friend's stored photo (≤720 px, no metadata), shown on the yearbook page
 */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { token, file } = await params
  const match = /^(.+)\.(png|jpg)$/i.exec(file)
  if (!match) throw new AppError(404, 'not_found', 'Yearbook files are at /y/<token>/<name>.png or .jpg.')
  const [, name, ext] = match
  const db = await getDb()
  if (ext.toLowerCase() === 'png') return slideResponse(await getYearbookSlide(db, token, name), req.url)

  const photo = await getYearbookPhoto(db, token, name)
  // Revalidated on every view, so a photo that was taken down disappears at once; the ETag makes a repeat view a 304.
  const etag = `"${createHash('sha256').update(photo).digest('base64url')}"`
  const headers = { etag, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' }
  const seen = (req.headers.get('if-none-match') ?? '').split(',').map((tag) => tag.trim().replace(/^W\//, ''))
  if (seen.includes(etag)) return new Response(null, { status: 304, headers })
  return new Response(new Uint8Array(photo), { headers: { ...headers, 'content-type': 'image/jpeg' } })
})
