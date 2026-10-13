import { getDb, handle } from '../../../../../lib/api'
import { slideResponse } from '../../../../../lib/slide'
import { AppError, getSlide } from '../../../../../lib/squad'

// Rendering takes about a second. Non-Latin text makes next/og fetch a fallback font, and this bounds that.
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string; file: string }> }

/**
 * GET /groups/:id/awards/:name.png → one friend's award as a 1080x1920 story PNG.
 * Locked groups get a visible watermark plus the watermark flag (PNG tEXt chunk and response header).
 */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id, file } = await params
  const name = /\.png$/i.test(file) ? file.slice(0, -'.png'.length) : ''
  if (!name) throw new AppError(404, 'not_found', 'Slides are at /groups/<id>/awards/<name>.png.')
  return slideResponse(await getSlide(await getDb(), id, name), req.url)
})
