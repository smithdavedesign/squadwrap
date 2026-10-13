'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { LIMITS } from '../lib/prompts'

export function CreateGroupForm({ defaultYear }: { defaultYear: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const memberCount = String(form.get('memberCount') ?? '').trim()
    setBusy(true)
    setError(null)
    const res = await fetch('/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        year: Number(form.get('year')),
        memberCount: memberCount ? Number(memberCount) : undefined,
      }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (!res?.ok) {
      setError(data?.error?.message ?? 'Could not create the group. Try again.')
      setBusy(false)
      return
    }
    router.push(`/groups/${encodeURIComponent(data.id)}`)
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <label>
        Group name
        <input name="name" required maxLength={LIMITS.groupName} placeholder="Flat 4B" autoComplete="off" />
      </label>
      <div className="row">
        <label>
          Year
          <input name="year" type="number" required min={LIMITS.minYear} max={LIMITS.maxYear} defaultValue={defaultYear} />
        </label>
        <label>
          How many of you? <span className="muted small">(optional)</span>
          <input name="memberCount" type="number" min={LIMITS.minMembers} max={LIMITS.maxMembers} placeholder="6" />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy}>{busy ? 'Creating…' : 'Create the group'}</button>
    </form>
  )
}
