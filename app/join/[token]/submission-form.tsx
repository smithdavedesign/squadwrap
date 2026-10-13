'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { LIMITS, PROMPTS } from '../../../lib/prompts'

/**
 * Shrinks a chosen photo in the browser before upload: upright, at most LIMITS.photoMaxSide px a side,
 * JPEG, with no EXIF (a canvas never carries it). Phone photos drop from megabytes to ~200 KB.
 * The server re-checks and re-encodes everything, so this is only about upload size and speed.
 */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    // Browsers apply EXIF orientation to <img> (and so to drawImage), so the photo comes out upright.
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, LIMITS.photoMaxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d canvas')
    context.fillStyle = '#ffffff' // transparent PNGs become white, as on the server
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function SubmissionForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneAs, setDoneAs] = useState<string | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    setPhotoError(null)
    setPhoto(null)
    if (!file) return
    setPhotoBusy(true)
    try {
      setPhoto(await shrinkPhoto(file))
    } catch {
      input.value = ''
      setPhotoError('That photo could not be read. Try a JPEG or PNG.')
    } finally {
      setPhotoBusy(false)
    }
  }

  function removePhoto() {
    setPhoto(null)
    setPhotoError(null)
    if (photoInput.current) photoInput.current.value = ''
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const answers = Object.fromEntries(PROMPTS.map((p) => [p.id, String(form.get(p.id) ?? '')]))
    setBusy(true)
    setError(null)
    const res = await fetch(`/join/${encodeURIComponent(token)}/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: form.get('displayName'),
        answers,
        photo: photo ?? undefined,
        adult: form.get('adult') === 'on',
      }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      setError(data?.error?.message ?? 'Could not send your answers. Try again.')
      return
    }
    setDoneAs(data.displayName)
  }

  if (doneAs) {
    return (
      <div className="card" role="status">
        <h2>You’re in, {doneAs}!</h2>
        <p className="muted">Your award drops when the organizer makes the wrap. Go nudge the others.</p>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <label>
        Your name
        <input
          name="displayName"
          required
          maxLength={LIMITS.displayName}
          placeholder="What the group calls you"
          autoComplete="nickname"
        />
      </label>
      {PROMPTS.map((prompt) => (
        <label key={prompt.id}>
          {prompt.label}
          <textarea name={prompt.id} required maxLength={LIMITS.answer} rows={2} />
        </label>
      ))}
      <label>
        A photo of you (optional)
        <span className="muted small block">It goes on your award slide, which the group gets to share.</span>
        {/* Not named, so FormData never picks up the raw file; the shrunk copy is sent instead. */}
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/*" onChange={onPhoto} />
      </label>
      {photoBusy && <p className="muted small">Preparing your photo…</p>}
      {photo && (
        <div className="photo-preview">
          <img src={photo} alt="Your photo" />
          <button type="button" className="secondary" onClick={removePhoto}>
            Remove photo
          </button>
        </div>
      )}
      {photoError && (
        <p className="error" role="alert">
          {photoError}
        </p>
      )}
      <label className="check">
        <input type="checkbox" name="adult" required />
        <span>I’m 18 or older. squadwrap is for adults only.</span>
      </label>
      <p className="muted small">
        Your answers and photo are deleted {LIMITS.retentionDays} days after the group was made. See{' '}
        <a href="/privacy">who sees what</a>.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy || photoBusy}>{busy ? 'Sending…' : 'Send my answers'}</button>
    </form>
  )
}
