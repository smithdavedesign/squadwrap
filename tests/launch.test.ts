// Launch readiness: each public page's metadata and JSON-LD, robots.txt, the sitemap, the share image, the Buy button
// (STRIPE_PAYMENT_LINK), the RepoHQ signal, the privacy and terms wording, and the provisioning request.
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveRobots, resolveSitemap } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data'
import RootLayout, { metadata as layoutMetadata } from '../app/layout'
import ShareImage, { alt as shareAlt, contentType as shareType, size as shareSize } from '../app/opengraph-image'
import { metadata as homeMetadata } from '../app/page'
import { metadata as privacyMetadata } from '../app/privacy/page'
import robots from '../app/robots'
import sitemap from '../app/sitemap'
import { metadata as termsMetadata } from '../app/terms/page'
import type { Db } from '../lib/db'
import { paymentLinkFor } from '../lib/payments'
import { UNLOCK_PRICE } from '../lib/prompts'
import {
  ACTIVATED_KEY,
  OPT_OUT_KEY,
  SIGNAL_URL,
  VISITED_KEY,
  externalReferrer,
  signalActivate,
  signalCheckout,
  signalVisit,
  signalsAllowed,
  type SignalWindow,
} from '../lib/signal'
import { ISSUES_URL, PUBLIC_PATHS, SHARE_IMAGE, siteUrl, softwareApplicationJsonLd } from '../lib/site'
import { getPage, groupWithAwards, hrefs, setUnlocked, testDb } from './helpers'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}))

afterEach(() => {
  vi.unstubAllEnvs()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>
const PAGES: [path: string, metadata: Loose][] = [
  ['/', homeMetadata],
  ['/privacy', privacyMetadata],
  ['/terms', termsMetadata],
]

/** The JSON-LD blocks in a page's HTML, parsed. */
function jsonLdIn(html: string): Loose[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
}

describe('public pages: search and sharing', () => {
  it('the public pages are exactly the home, privacy and terms pages', () => {
    expect(PAGES.map(([path]) => path)).toEqual([...PUBLIC_PATHS])
  })

  it.each(PAGES)('%s renders (200)', async (path) => {
    const { status, html } = await getPage(path)
    expect(status).toBe(200)
    expect(html).toContain('<h1>')
  })

  it('each has its own title and meta description', () => {
    const titles = PAGES.map(([, m]) => m.title)
    const descriptions = PAGES.map(([, m]) => m.description)
    for (const text of [...titles, ...descriptions]) expect(typeof text === 'string' && text.length > 10, text).toBe(true)
    expect(new Set(titles).size).toBe(PAGES.length)
    expect(new Set(descriptions).size).toBe(PAGES.length)
    for (const description of descriptions) expect(description.length).toBeLessThanOrEqual(160)
  })

  it.each(PAGES)('%s has a canonical URL, Open Graph and a large Twitter card, both with the 1200×630 image', (path, m) => {
    expect(m.alternates).toEqual({ canonical: path })
    expect(m.openGraph).toMatchObject({ type: 'website', siteName: 'squadwrap', url: path, title: m.title, description: m.description })
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', title: m.title, description: m.description })
    for (const images of [m.openGraph.images, m.twitter.images]) {
      expect(images).toEqual([expect.objectContaining({ url: '/opengraph-image', width: 1200, height: 630, alt: expect.any(String) })])
    }
  })

  it.each(PAGES)('%s carries JSON-LD: a SoftwareApplication with a $6 one-time Offer', async (path) => {
    const blocks = jsonLdIn((await getPage(path)).html)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'squadwrap',
      offers: { '@type': 'Offer', price: '6.00', priceCurrency: 'USD' },
    })
    expect(blocks[0].offers.description).toMatch(/once per group/)
  })

  it('the JSON-LD points at the production domain', () => {
    const data = softwareApplicationJsonLd(new URL('https://squadwrap.example'))
    expect(data.url).toBe('https://squadwrap.example/')
    expect(data.image).toBe('https://squadwrap.example/opengraph-image')
    expect(data.offers.url).toBe('https://squadwrap.example/terms')
  })

  it('the root layout resolves relative URLs against the site (metadataBase) and keeps the no-referrer policy', () => {
    expect(layoutMetadata.metadataBase).toBeInstanceOf(URL)
    expect(layoutMetadata.referrer).toBe('no-referrer')
    // Private-link pages inherit no canonical URL from the layout: theirs would point at someone's key.
    expect(layoutMetadata.alternates).toBeUndefined()
  })

  it('the site URL is the production domain on Vercel (a custom domain once set), else localhost', () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'squadwrap.example' }).href).toBe('https://squadwrap.example/')
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: '  ' }).href).toBe('http://localhost:3000/')
    expect(siteUrl({}).href).toBe('http://localhost:3000/')
    expect(siteUrl({ PORT: '3198' }).href).toBe('http://localhost:3198/')
  })
})

describe('the share image', () => {
  it('is a 1200×630 PNG drawn by code', async () => {
    expect(shareSize).toEqual({ width: 1200, height: 630 })
    expect(shareType).toBe('image/png')
    expect(shareAlt).toBe(SHARE_IMAGE.alt)
    const res = ShareImage()
    expect(res.headers.get('content-type')).toBe('image/png')
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'png', width: 1200, height: 630 })
  })
})

describe('robots.txt and sitemap.xml', () => {
  it('robots.txt allows everything and points at the sitemap', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'squadwrap.example')
    const text = resolveRobots(robots())
    expect(text).toBe('User-Agent: *\nAllow: /\n\nSitemap: https://squadwrap.example/sitemap.xml\n')
    expect(text).not.toMatch(/Disallow/)
  })

  it('sitemap.xml lists the public pages, absolute, and no private-link page', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'squadwrap.example')
    const entries = sitemap()
    expect(entries.map((e) => e.url)).toEqual(['https://squadwrap.example/', 'https://squadwrap.example/privacy', 'https://squadwrap.example/terms'])
    const xml = resolveSitemap(entries)
    expect(xml).toContain('<loc>https://squadwrap.example/terms</loc>')
    expect(xml).not.toMatch(/\/(groups|join|y)\//)
  })
})

describe('the Buy button (STRIPE_PAYMENT_LINK)', () => {
  const LINK = 'https://example.com/pay'
  const buyLink = /<a[^>]*class="button-buy"[^>]*>/
  let db: Db
  beforeAll(async () => {
    db = await testDb()
  })

  it('is hidden when STRIPE_PAYMENT_LINK is unset', async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', '')
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const { html } = await getPage(`/groups/${group.id}`)
    expect(html).not.toMatch(buyLink)
    expect(html).not.toContain('Buy the unlock')
  })

  it('links to the payment link with the group attached, in a new tab, with the price, once the awards exist', async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', LINK)
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    const { html } = await getPage(`/groups/${group.id}`)
    const tag = html.match(buyLink)?.[0] ?? ''
    expect(tag).toContain('target="_blank"')
    expect(tag).toContain('rel="noopener noreferrer"')
    expect(hrefs(html)).toContain(`${LINK}?client_reference_id=${group.id}`)
    expect(html).toContain(`Buy the unlock, ${UNLOCK_PRICE.label}`)
    // The Checkout button is the fallback for when there's no link.
    expect(html).not.toContain(`Unlock for ${UNLOCK_PRICE.label}`)
  })

  it('is not offered once the group is unlocked', async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', LINK)
    const group = await groupWithAwards(db, ['Ana', 'Ben', 'Cat'])
    await setUnlocked(db, group.id)
    expect((await getPage(`/groups/${group.id}`)).html).not.toMatch(buyLink)
  })

  it('accepts only an https URL, and keeps the link’s own query', () => {
    expect(paymentLinkFor('g1', {})).toBeNull()
    expect(paymentLinkFor('g1', { STRIPE_PAYMENT_LINK: '   ' })).toBeNull()
    expect(paymentLinkFor('g1', { STRIPE_PAYMENT_LINK: 'not a url' })).toBeNull()
    expect(paymentLinkFor('g1', { STRIPE_PAYMENT_LINK: 'http://example.com/pay' })).toBeNull()
    expect(paymentLinkFor('g1', { STRIPE_PAYMENT_LINK: 'javascript:alert(1)' })).toBeNull()
    expect(paymentLinkFor('g1', { STRIPE_PAYMENT_LINK: ` ${LINK} ` })).toBe(`${LINK}?client_reference_id=g1`)
    expect(paymentLinkFor('a_B-9', { STRIPE_PAYMENT_LINK: `${LINK}?locale=en` })).toBe(`${LINK}?locale=en&client_reference_id=a_B-9`)
  })
})

/** A stand-in for the browser: storage maps, and a fetch that records what it was asked to send. */
function fakeBrowser({ referrer = '', webdriver = false, local = new Map<string, string>(), session = new Map<string, string>() } = {}) {
  const sent: { url: string; init: RequestInit }[] = []
  const store = (map: Map<string, string>) => ({
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  })
  const win: SignalWindow = {
    navigator: { webdriver },
    location: { origin: 'https://squadwrap.example' },
    document: { referrer },
    localStorage: store(local),
    sessionStorage: store(session),
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(url), init: init ?? {} })
      return new Response(null, { status: 204 })
    }) as typeof fetch,
  }
  return { win, sent, local, session }
}

const PROD = 'production'

describe('the RepoHQ signal', () => {
  // The fallback when a test passes no vercelEnv, whatever the shell holds.
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
  })

  it('sends a visit once per browser session: POST JSON {slug, kind, referrer}, keepalive, no cookies, no Referer', () => {
    const browser = fakeBrowser()
    expect(signalVisit({ win: browser.win, vercelEnv: PROD })).toBe(true)
    expect(signalVisit({ win: browser.win, vercelEnv: PROD })).toBe(false)
    expect(browser.sent).toHaveLength(1)
    const [{ url, init }] = browser.sent
    expect(url).toBe(SIGNAL_URL)
    expect(url).toBe('https://repohq.vercel.app/api/ideas/signal')
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ slug: 'squadwrap', kind: 'visit', referrer: null })
    expect(browser.session.has(VISITED_KEY)).toBe(true)

    // A new session in the same browser counts again.
    const nextSession = fakeBrowser({ local: browser.local })
    expect(signalVisit({ win: nextSession.win, vercelEnv: PROD })).toBe(true)
  })

  it('sends activate once per browser, across sessions', () => {
    const local = new Map<string, string>()
    const first = fakeBrowser({ local })
    expect(signalActivate({ win: first.win, vercelEnv: PROD })).toBe(true)
    expect(JSON.parse(String(first.sent[0].init.body))).toEqual({ slug: 'squadwrap', kind: 'activate', referrer: null })
    expect(local.has(ACTIVATED_KEY)).toBe(true)
    const later = fakeBrowser({ local })
    expect(signalActivate({ win: later.win, vercelEnv: PROD })).toBe(false)
    expect(later.sent).toHaveLength(0)
  })

  it('sends checkout on every click on Buy', () => {
    const browser = fakeBrowser()
    signalCheckout({ win: browser.win, vercelEnv: PROD })
    signalCheckout({ win: browser.win, vercelEnv: PROD })
    expect(browser.sent.map((s) => JSON.parse(String(s.init.body)).kind)).toEqual(['checkout', 'checkout'])
  })

  it('names the referrer only when it is another site, so our own (private) links never leave the page', () => {
    const origin = 'https://squadwrap.example'
    expect(externalReferrer('https://www.reddit.com/r/friends/', origin)).toBe('https://www.reddit.com/r/friends/')
    expect(externalReferrer('https://squadwrap.example/groups/abcDEF123_-xyz0000000', origin)).toBeNull()
    expect(externalReferrer('https://squadwrap.example/', origin)).toBeNull()
    expect(externalReferrer('', origin)).toBeNull()
    expect(externalReferrer('not a url', origin)).toBeNull()

    const fromChat = fakeBrowser({ referrer: 'https://web.whatsapp.com/' })
    signalVisit({ win: fromChat.win, vercelEnv: PROD })
    expect(JSON.parse(String(fromChat.sent[0].init.body)).referrer).toBe('https://web.whatsapp.com/')
    const fromOurPage = fakeBrowser({ referrer: 'https://squadwrap.example/join/inviteTOKEN_0000000000' })
    signalCheckout({ win: fromOurPage.win, vercelEnv: PROD })
    expect(String(fromOurPage.sent[0].init.body)).not.toContain('inviteTOKEN')
  })

  type Case = { vercelEnv: string | undefined; webdriver: boolean; notrack: string | null }
  const cases: [string, Case][] = [
    ['a preview deployment', { vercelEnv: 'preview', webdriver: false, notrack: null }],
    ['local development (no VERCEL_ENV)', { vercelEnv: undefined, webdriver: false, notrack: null }],
    ['an automated browser (navigator.webdriver)', { vercelEnv: PROD, webdriver: true, notrack: null }],
    ['the owner’s browser (repohq:notrack set)', { vercelEnv: PROD, webdriver: false, notrack: '1' }],
    ['the owner’s browser (repohq:notrack set to an empty string)', { vercelEnv: PROD, webdriver: false, notrack: '' }],
  ]
  it.each(cases)('sends nothing from %s', (_label, { vercelEnv, webdriver, notrack }) => {
    const local = new Map<string, string>(notrack === null ? [] : [[OPT_OUT_KEY, notrack]])
    const browser = fakeBrowser({ webdriver, local })
    expect(signalsAllowed(browser.win, vercelEnv)).toBe(false)
    expect(signalVisit({ win: browser.win, vercelEnv })).toBe(false)
    expect(signalActivate({ win: browser.win, vercelEnv })).toBe(false)
    expect(signalCheckout({ win: browser.win, vercelEnv })).toBe(false)
    expect(browser.sent).toHaveLength(0)
    // Nothing remembered either, so nothing is skipped later by mistake.
    expect(browser.session.has(VISITED_KEY)).toBe(false)
    expect(local.has(ACTIVATED_KEY)).toBe(false)
  })

  it('sends nothing when storage is blocked, and never throws when the network fails', async () => {
    const blocked = fakeBrowser()
    blocked.win.localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
    }
    expect(signalVisit({ win: blocked.win, vercelEnv: PROD })).toBe(false)
    expect(blocked.sent).toHaveLength(0)

    const offline = fakeBrowser()
    offline.win.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch
    expect(signalVisit({ win: offline.win, vercelEnv: PROD })).toBe(true)
    const throwing = fakeBrowser()
    throwing.win.fetch = (() => {
      throw new TypeError('keepalive quota exceeded')
    }) as typeof fetch
    expect(() => signalCheckout({ win: throwing.win, vercelEnv: PROD })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('privacy, terms and the footer', () => {
  it('the privacy page names the three signal events, what they carry, cookies, and GitHub issues as the contact', async () => {
    const { html } = await getPage('/privacy')
    for (const kind of ['visit', 'activate', 'checkout']) expect(html).toContain(`<strong>${kind}</strong>`)
    expect(html).toMatch(/RepoHQ/)
    expect(html).toMatch(/no cookies/)
    expect(html).toMatch(/no page address/)
    expect(hrefs(html)).toContain(ISSUES_URL)
    expect(ISSUES_URL).toBe('https://github.com/smithdavedesign/squadwrap/issues')
  })

  it('the terms state the price once per group, the refund line from REVENUE.md, no warranty, and GitHub issues', async () => {
    const { html } = await getPage('/terms')
    expect(html).toContain(`${UNLOCK_PRICE.label} once per group`)
    expect(UNLOCK_PRICE).toEqual({ cents: 600, currency: 'usd', label: '$6' })
    expect(html).toMatch(/Refund on request, no questions asked/)
    expect(html).toMatch(/without warranty of any kind/)
    expect(hrefs(html)).toContain(ISSUES_URL)
  })

  it('the footer on every page links privacy and terms', () => {
    const links = hrefs(renderToStaticMarkup(createElement(RootLayout, null, createElement('p', null, 'page'))))
    expect(links).toEqual(expect.arrayContaining(['/privacy', '/terms']))
  })
})

describe('provisioning', () => {
  it('.provision asks for the Vercel project and the $6 payment link, and holds no secret', async () => {
    const text = await readFile(new URL('../.provision', import.meta.url), 'utf8')
    expect(text.trim().split('\n')).toEqual([
      'vercel project squadwrap',
      'request "Stripe payment link for squadwrap: $6 once, per REVENUE.md"',
    ])
  })
})
