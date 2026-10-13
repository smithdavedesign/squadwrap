'use client'

import { useState, type FormEvent } from 'react'
import { LIMITS } from '../../../../lib/prompts'

export function ReportForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    const res = await fetch(`/y/${encodeURIComponent(token)}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: form.get('reason'), contact: form.get('contact') }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      setError(data?.error?.message ?? 'Could not send the report. Try again.')
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="card" role="status">
        <h2>Thanks, we got it.</h2>
        <p className="muted">We’ll look at it and take down anything that breaks the rules.</p>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <label>
        What’s wrong?
        <span className="muted small block">Say whose award or photo it is.</span>
        <textarea name="reason" required maxLength={LIMITS.reportReason} rows={4} />
      </label>
      <label>
        How can we reach you? <span className="muted small">(optional)</span>
        <input name="contact" maxLength={LIMITS.reportContact} autoComplete="email" placeholder="Only if you want an answer" />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy}>{busy ? 'Sending…' : 'Send the report'}</button>
    </form>
  )
}
