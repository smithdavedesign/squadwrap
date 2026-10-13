import type { Metadata } from 'next'
import { connection } from 'next/server'
import { LIMITS, UNLOCK_PRICE } from '../lib/prompts'
import { JsonLd, publicPageMetadata } from '../lib/site'
import { CreateGroupForm } from './create-group-form'

export const metadata: Metadata = publicPageMetadata({
  title: 'squadwrap: Wrapped for your friend group',
  description:
    'Friends answer five silly prompts and everyone gets an award for the year: a story slide per friend and a group yearbook. No app, no account, free to try.',
  path: '/',
})

export default async function Home() {
  // Rendered per request so the default year is never frozen at build time.
  await connection()
  return (
    <>
      <JsonLd />
      <h1>squadwrap</h1>
      <p className="lead">
        Spotify Wrapped for your friend group. Friends answer five silly prompts, and everyone gets an award for the year.
      </p>
      <CreateGroupForm defaultYear={new Date().getUTCFullYear()} />
      <ol className="steps">
        <li>Name your group and drop the invite link in the group chat.</li>
        <li>Friends answer five prompts. No app, no account.</li>
        <li>Once three or more have answered, make the awards.</li>
      </ol>
      <p className="muted small">
        For groups of adults (18+). Free to try; {UNLOCK_PRICE.label} once per group takes the watermark off the slides.
        Everything is deleted {LIMITS.retentionDays} days after the group is made.
      </p>
    </>
  )
}
