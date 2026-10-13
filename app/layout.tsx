import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SITE_NAME, TAGLINE, siteUrl } from '../lib/site'
import './globals.css'
import { VisitSignal } from './visit-signal'

// Defaults for every page. The public pages (/, /privacy, /terms) set their own title, description, canonical URL and
// card (lib/site.tsx); private-link pages keep these, with their own title, and the share image from opengraph-image.
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: 'squadwrap: Wrapped for your friend group',
  description: TAGLINE,
  applicationName: SITE_NAME,
  openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US' },
  twitter: { card: 'summary_large_image' },
  // Group and invite URLs are the keys to a group, so never leak them in a Referer header.
  referrer: 'no-referrer',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
        {/* On every page: what happens to people's data, the rules, and how to get something taken down. */}
        <footer className="site-footer muted small">
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/terms#report">Report a problem</a>
          <span className="block">squadwrap is for adults (18+).</span>
        </footer>
        <VisitSignal />
      </body>
    </html>
  )
}
