// Photos are processed by Photon, a WebAssembly module loaded on first use. If it fails to load on a deploy (a missing
// .wasm file in the Worker, say), only photo uploads may break: everything else, including submissions without a
// photo, keeps working.
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@cf-wasm/photon', () => {
  throw new Error('No such module "photon_rs_bg.wasm"')
})

const { createPgliteDb, migrate } = await import('../lib/db')
const { PhotoError, normalizePhoto } = await import('../lib/photo')
const { AppError, addSubmission, createGroup } = await import('../lib/squad')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngLike = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64)])
const answers = { cancels: 'Jo', lore: 'karaoke', mainCharacter: 'last train', threeWords: 'loud', secretAward: 'Lurker' }

describe('when Photon cannot be loaded', () => {
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
