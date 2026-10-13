// The RepoHQ usage signal: an anonymous count of visits, activations and Buy clicks, so the owner can see whether
// anyone uses the app. Browser-only. Each message is {slug, kind, referrer} and nothing else: no cookies, no ids, and
// never the page address (squadwrap's links are the keys to a group). The privacy page describes exactly this.

export const SIGNAL_URL = 'https://repohq.vercel.app/api/ideas/signal'
export const SIGNAL_SLUG = 'squadwrap'

/**
 * visit: the first page in a browser session. activate: the first time this browser makes a group's awards (the core
 * action). checkout: a click on Buy.
 */
export type SignalKind = 'visit' | 'activate' | 'checkout'

/** Set by the owner in their own browser (any value) so their use isn't counted. */
export const OPT_OUT_KEY = 'repohq:notrack'
/** sessionStorage: a visit was counted in this browser session. */
export const VISITED_KEY = 'repohq:visited'
/** localStorage: an activation was counted in this browser. */
export const ACTIVATED_KEY = 'repohq:activated'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** The parts of `window` the signal reads; tests pass a stand-in. */
export type SignalWindow = {
  navigator: { webdriver?: boolean }
  location: { origin: string }
  document: { referrer: string }
  localStorage: Store
  sessionStorage: Store
  fetch: typeof fetch
}

/** Where the visitor came from, only when that's another site; our own pages (and so our links) never leave. */
export function externalReferrer(referrer: string, origin: string): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).origin === origin ? null : referrer
  } catch {
    return null
  }
}

/**
 * Production deployments only (Vercel's VERCEL_ENV, which Next.js inlines as NEXT_PUBLIC_VERCEL_ENV at build time),
 * never automated browsers (bots, screenshot runs) or the owner's opted-out browser. Storage that can't be read
 * counts as "don't": the opt-out couldn't be honoured, nor a visit counted only once.
 */
export function signalsAllowed(win: SignalWindow, vercelEnv: string | undefined): boolean {
  if (vercelEnv !== 'production' || win.navigator.webdriver) return false
  try {
    return win.localStorage.getItem(OPT_OUT_KEY) === null
  } catch {
    return false
  }
}

/** Fire and forget: keepalive so it survives leaving the page, no cookies, no Referer header, errors swallowed. */
function send(win: SignalWindow, kind: SignalKind): void {
  const body = JSON.stringify({ slug: SIGNAL_SLUG, kind, referrer: externalReferrer(win.document.referrer, win.location.origin) })
  try {
    win
      .fetch(SIGNAL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      .catch(() => {})
  } catch {
    // A signal must never break the page.
  }
}

/** Sends `kind` unless `store` already holds `key`, then remembers it. False when nothing was sent. */
function sendOnce(win: SignalWindow, vercelEnv: string | undefined, kind: SignalKind, store: Store, key: string): boolean {
  if (!signalsAllowed(win, vercelEnv)) return false
  try {
    if (store.getItem(key) !== null) return false
    store.setItem(key, '1')
  } catch {
    return false
  }
  send(win, kind)
  return true
}

/** Tests pass both; the browser uses the defaults below. */
type SignalTarget = { win?: SignalWindow; vercelEnv?: string }

// `process.env.NEXT_PUBLIC_VERCEL_ENV` must be spelled out like this for Next.js to inline it into the browser bundle.

/** "visit", once per browser session. */
export function signalVisit({ win = window, vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV }: SignalTarget = {}): boolean {
  return sendOnce(win, vercelEnv, 'visit', win.sessionStorage, VISITED_KEY)
}

/** "activate", once per browser: the first awards this browser makes. */
export function signalActivate({ win = window, vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV }: SignalTarget = {}): boolean {
  return sendOnce(win, vercelEnv, 'activate', win.localStorage, ACTIVATED_KEY)
}

/** "checkout", on every click on Buy. */
export function signalCheckout({ win = window, vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV }: SignalTarget = {}): boolean {
  if (!signalsAllowed(win, vercelEnv)) return false
  send(win, 'checkout')
  return true
}
