import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'squadwrap: Wrapped for your friend group',
  description: 'Friends answer five silly prompts and everyone gets an award for the year.',
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
      </body>
    </html>
  )
}
