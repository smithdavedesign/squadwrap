// What search engines and link previews see: the site's address, each public page's metadata, the share image and
// the JSON-LD. Server-only (pages, robots.ts, sitemap.ts).
import type { Metadata } from 'next'
import { UNLOCK_PRICE } from './prompts'

export const SITE_NAME = 'squadwrap'
export const TAGLINE = 'Friends answer five silly prompts, and everyone gets an award for the year.'

/** The product's repository; its issues are the public contact route named on the privacy and terms pages. */
export const REPO_URL = 'https://github.com/smithdavedesign/squadwrap'
export const ISSUES_URL = `${REPO_URL}/issues`

/** The pages meant for search engines and sharing. Every other page sits behind a private link and says noindex. */
export const PUBLIC_PATHS = ['/', '/privacy', '/terms'] as const
export type PublicPath = (typeof PUBLIC_PATHS)[number]

/**
 * The site's public origin, for canonical URLs, the sitemap and robots.txt. On Vercel that's the project's production
 * domain (a system env var, set on preview deploys too, so they point search engines at production), which becomes the
 * custom domain once one is made the production domain. Locally, localhost.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  return new URL(host ? `https://${host}` : `http://localhost:${env.PORT?.trim() || 3000}`)
}

/** The 1200×630 share image, drawn by app/opengraph-image.tsx at build time. */
export const SHARE_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'squadwrap: Wrapped for your friend group. One award per friend, made from what they answer.',
  type: 'image/png',
} as const

/**
 * A public page's title, description, canonical URL, Open Graph and Twitter card. The share image is named here
 * because a page's own `openGraph` replaces the root's, file-based image included.
 */
export function publicPageMetadata({ title, description, path }: { title: string; description: string; path: PublicPath }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      url: path,
      title,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: { card: 'summary_large_image', title, description, images: [SHARE_IMAGE] },
  }
}

/** schema.org's description of the app and its one offer: the unlock, paid once per group. */
export function softwareApplicationJsonLd(site: URL = siteUrl()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    description: `Wrapped for your friend group. ${TAGLINE} No app, no account.`,
    url: new URL('/', site).href,
    image: new URL(SHARE_IMAGE.url, site).href,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any (web browser)',
    offers: {
      '@type': 'Offer',
      price: (UNLOCK_PRICE.cents / 100).toFixed(2),
      priceCurrency: UNLOCK_PRICE.currency.toUpperCase(),
      description: `${UNLOCK_PRICE.label} once per group, not a subscription: every award slide of that group without the watermark.`,
      url: new URL('/terms', site).href,
    },
  }
}

/** The JSON-LD as a script tag. The data is ours, not user input; `<` is escaped anyway, as Next's guide does. */
export function JsonLd() {
  const json = JSON.stringify(softwareApplicationJsonLd()).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
