'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { nudgeText } from '../../../lib/nudge'
import { LIMITS, UNLOCK_PRICE } from '../../../lib/prompts'

/** The full URL for a path. It needs the browser's origin, which the server render doesn't know. */
function useAbsoluteUrl(path: string): string {
  const [url, setUrl] = useState(path)
  useEffect(() => setUrl(window.location.origin + path), [path])
  return url
}

/** Copies `text`; where the clipboard is blocked, selects the field so the person can copy it by hand. */
function useCopy(text: string, field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      field.current?.select()
    }
  }
  return { copied, copy }
}

export function CopyLink({ path, label }: { path: string; label: string }) {
  const url = useAbsoluteUrl(path)
  const input = useRef<HTMLInputElement>(null)
  const { copied, copy } = useCopy(url, input)

  return (
    <div className="copy">
      <input ref={input} readOnly value={url} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

/** The nudge message for the group chat, with a Copy button; nothing once everyone counted has answered. */
export function Nudge(props: { groupName: string; year: number; answered: string[]; memberCount: number | null; invitePath: string }) {
  const { invitePath, ...rest } = props
  const inviteUrl = useAbsoluteUrl(invitePath)
  const text = nudgeText({ ...rest, inviteUrl })
  const area = useRef<HTMLTextAreaElement>(null)
  const { copied, copy } = useCopy(text ?? '', area)
  if (!text) return null

  return (
    <div className="nudge">
      <p className="muted small">Nudge the rest: paste this into the group chat.</p>
      <textarea ref={area} readOnly value={text} rows={3} aria-label="Nudge message" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy}>
        {copied ? 'Copied!' : 'Copy message'}
      </button>
    </div>
  )
}

/** Opens Stripe Checkout for this group; the webhook unlocks it once paid. */
export function UnlockButton({ groupId }: { groupId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Coming back from Stripe with the Back button restores this page from the back/forward cache, mid-"Opening…".
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  async function unlock() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/groups/${encodeURIComponent(groupId)}/checkout`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (!res?.ok || typeof data?.url !== 'string') {
      setError(data?.error?.message ?? 'The payment page didn’t open. Try again.')
      setBusy(false)
      return
    }
    window.location.assign(data.url)
  }

  return (
    <>
      <button type="button" onClick={unlock} disabled={busy}>
        {busy ? 'Opening the payment page…' : `Unlock for ${UNLOCK_PRICE.label}`}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

const PAYMENT_POLL_MS = 2000
const PAYMENT_POLL_TRIES = 30

/**
 * Back from Stripe Checkout before its webhook has landed: refreshes the page (server data only) every 2 s until it
 * shows the group unlocked, for up to a minute.
 */
export function PaymentPending({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (tries > PAYMENT_POLL_TRIES) {
        clearInterval(timer)
        setGaveUp(true)
        return
      }
      router.refresh()
    }, PAYMENT_POLL_MS)
    return () => clearInterval(timer)
  }, [router])

  return (
    <p role="status">
      Payment received. Unlocking your slides…
      {gaveUp && (
        <>
          {' '}
          This is taking longer than usual: refresh in a moment. Didn’t pay after all?{' '}
          <a href={`/groups/${encodeURIComponent(groupId)}`}>Back to the unlock button</a>.
        </>
      )}
    </p>
  )
}

export function GenerateButton({ groupId, missing, hasAwards }: { groupId: string; missing: number; hasAwards: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/groups/${encodeURIComponent(groupId)}/generate`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      setError(data?.error?.message ?? 'Could not make the awards. Try again.')
      return
    }
    router.refresh()
  }

  if (missing > 0) {
    return (
      <p className="muted">
        Waiting for {missing} more {missing === 1 ? 'answer' : 'answers'}. Awards need at least{' '}
        {LIMITS.minSubmissionsToGenerate}.
      </p>
    )
  }
  return (
    <div>
      <button type="button" onClick={generate} disabled={busy}>
        {busy ? 'Writing the awards…' : hasAwards ? 'Remake the awards' : 'Make the awards'}
      </button>
      {hasAwards && <p className="muted small">Remaking replaces every award and includes anyone who answered since.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
