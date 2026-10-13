import type { Metadata } from 'next'
import { LIMITS, UNLOCK_PRICE } from '../../lib/prompts'
import { ISSUES_URL, JsonLd, publicPageMetadata } from '../../lib/site'

export const metadata: Metadata = publicPageMetadata({
  title: 'Privacy · squadwrap',
  description: 'What squadwrap stores, who else sees it, the anonymous visit count, and when everything is deleted.',
  path: '/privacy',
})

/**
 * Kept in step with the code: what's stored (lib/db.ts), where it goes (model, slides, Stripe), the visit count
 * (lib/signal.ts) and the cleanup job.
 */
export default function PrivacyPage() {
  return (
    <article className="legal">
      <JsonLd />
      <h1>Privacy</h1>
      <p className="lead">
        squadwrap keeps as little as it can, shares it with as few services as it can, and deletes everything{' '}
        {LIMITS.retentionDays} days after a group is made.
      </p>
      <p>
        The <a href="/terms">terms</a> say who can use squadwrap and what may be posted.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>For each group: its name, the year and, if the organizer gave it, how many friends are in it.</li>
        <li>
          For each friend who answers: the display name they type, their answers to five prompts, and a photo if they add
          one. Photos are shrunk to at most {LIMITS.photoMaxSide} pixels and stripped of their metadata (such as location)
          before they are stored.
        </li>
        <li>The awards the AI writes from those answers.</li>
        <li>Reports sent from a yearbook: what’s wrong and, only if the reporter gives them, contact details.</li>
      </ul>
      <p>
        There are no accounts, no email lists, no cookies and no ads, and nothing follows you to other sites. The only
        count kept is the anonymous one described under “The visit count”. The links themselves are the keys: whoever has
        the organizer link, the invite link or the yearbook link can open that page.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          <strong>Your group.</strong> Everyone with the yearbook link sees every award and photo in it. The organizer
          sees who has answered and the awards.
        </li>
        <li>
          <strong>The AI provider.</strong> When the organizer makes the awards, the group’s name and year and everyone’s
          display names and answers (never the photos) are sent to the configured AI provider that writes them: Google’s
          Gemini API, unless the operator has set up another one.
        </li>
        <li>
          <strong>Google Fonts.</strong> If a slide has text in a script our font doesn’t cover (for example Chinese,
          Arabic or Hindi), those characters are sent to Google Fonts to fetch the letters for that slide.
        </li>
        <li>
          <strong>Stripe.</strong> If the organizer pays {UNLOCK_PRICE.label} to unlock a group, Stripe handles the
          payment: card details go to Stripe, never to us. Stripe receives the key in the organizer link (so the payment
          unlocks the right group) and may receive the group’s name (as the item bought). It keeps its payment records as
          the law requires.
        </li>
        <li>
          <strong>Hosting.</strong> The app runs on Vercel and the data lives in a Neon Postgres database. Their request
          logs contain page addresses, and so the private links.
        </li>
      </ul>

      <h2 id="visit-count">The visit count</h2>
      <p>
        So its maker can see whether anyone uses squadwrap, your browser sends a tiny anonymous message to RepoHQ
        (repohq.vercel.app, the maker’s project dashboard) on three occasions:
      </p>
      <ul>
        <li>
          <strong>visit</strong>: the first page you open in a browser session;
        </li>
        <li>
          <strong>activate</strong>: the first time awards are made in your browser;
        </li>
        <li>
          <strong>checkout</strong>: when you click Buy.
        </li>
      </ul>
      <p>
        Each message holds the app’s name, which of the three it is and, only if you arrived from another website, that
        site’s address. Nothing else: no cookie, no identifier, no page address (so never a group’s link), no names,
        answers or photos. Like any web request, it shows RepoHQ’s host your IP address. Nothing is sent from test
        deployments or automated browsers. Your browser’s own storage keeps two notes so that each is counted once: one
        for this session’s visit, one for an activation.
      </p>

      <h2>When it is deleted</h2>
      <p>
        A daily job deletes every group {LIMITS.retentionDays} days after it was made, early on that day (UTC): its
        answers, photos, awards and reports, and every link to it stops working. The organizer page and the yearbook show
        the date. Save the slides you want to keep before then.
      </p>

      <h2>Getting something taken down sooner</h2>
      <p>
        Every yearbook has a “Report it or ask for a takedown” link at the bottom. Use it to have an award, a photo or a
        whole group removed; see the <a href="/terms#report">terms</a> for what we take down.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        For questions about your data, open an issue on <a href={ISSUES_URL}>squadwrap’s GitHub</a>. Issues are public:
        never post a group’s links, anyone’s name or a photo there. To have something removed, use the yearbook’s report
        link above.
      </p>
    </article>
  )
}
