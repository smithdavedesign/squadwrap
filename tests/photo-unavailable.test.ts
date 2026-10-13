// sharp is a native module. If it fails to load on a deploy (a known failure mode for Next.js + Turbopack on
// Vercel), only photo uploads may break: everything else, including submissions without a photo, keeps working.
// This file must not import sharp itself (nor tests/helpers.ts, which does).
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('sharp', () => {
  throw new Error('ERR_DLOPEN_FAILED: libvips-cpp.so.8: cannot open shared object file')
})

const { createPgliteDb, migrate } = await import('../lib/db')
const { PhotoError, normalizePhoto } = await import('../lib/photo')
const { AppError, addSubmission, createGroup } = await import('../lib/squad')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngLike = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64)])
const answers = { cancels: 'Jo', lore: 'karaoke', mainCharacter: 'last train', threeWords: 'loud', secretAward: 'Lurker' }

describe('when sharp cannot be loaded', () => {
  let db: Awaited<ReturnType<typeof createPgliteDb>>
  beforeAll(async () => {
    db = await createPgliteDb()
    await migrate(db)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('normalizePhoto fails with a 503-type PhotoError instead of crashing the module', async () => {
    const err = await normalizePhoto(pngLike).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PhotoError)
    expect((err as InstanceType<typeof PhotoError>).status).toBe(503)
  })

  it('a submission with a photo gets 503 photos_unavailable, and nothing is stored', async () => {
    const group = await createGroup(db, { name: 'Flat 4B' }, 'http://localhost')
    const photo = `data:image/png;base64,${pngLike.toString('base64')}`
    const err = await addSubmission(db, group.id, { displayName: 'Ana', answers, photo, adult: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err).toMatchObject({ status: 503, code: 'photos_unavailable' })
    const { rows } = await db.query('SELECT 1 FROM submissions WHERE group_id = $1', [group.id])
    expect(rows).toHaveLength(0)
  })

  it('a submission without a photo still works', async () => {
    const group = await createGroup(db, { name: 'Flat 4B' }, 'http://localhost')
    await expect(addSubmission(db, group.id, { displayName: 'Ben', answers, adult: true })).resolves.toEqual({ displayName: 'Ben' })
  })
})
