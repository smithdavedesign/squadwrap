import type { Metadata } from 'next'
import { LIMITS, UNLOCK_PRICE } from '../../lib/prompts'
import { ISSUES_URL, JsonLd, publicPageMetadata } from '../../lib/site'

export const metadata: Metadata = publicPageMetadata({
  title: 'Terms · squadwrap',
  description: `Who can use squadwrap, what the ${UNLOCK_PRICE.label} unlock buys, refunds on request, takedowns, and no warranty.`,
  path: '/terms',
})

/**
 * Kept in step with the code and REVENUE.md: 18+ (lib/squad.ts), the price and the refund line (lib/prompts.ts),
 * the cleanup job and the report form.
 */
export default function TermsPage() {
  return (
    <article className="legal">
      <JsonLd />
      <h1>Terms</h1>
      <p className="lead">Short version: adults only, be kind, only post yourself, and ask us if anything goes wrong.</p>

      <h2>Who can use it</h2>
      <p>
        squadwrap is for groups of adults. Every friend confirms they are 18 or older before their answers are accepted.
        Don’t invite anyone younger.
      </p>

      <h2>What you can post</h2>
      <ul>
        <li>Only a photo of yourself, and only one you are happy for your group to share.</li>
        <li>
          Nothing about minors, health, bodies, abuse, sex, money, religion or politics, and nothing about people who aren’t
          in the group.
        </li>
        <li>Tease, don’t humiliate. We take down anything that breaks these rules.</li>
      </ul>
      <p>
        The awards are written by an AI from what the group answered. They can miss the mark; the organizer can remake
        them for free as often as they like.
      </p>

      <h2>The unlock</h2>
      <p>
        Making the awards, the yearbook and the slides is free; free slides carry a “PREVIEW” watermark. The organizer can
        pay <strong>{UNLOCK_PRICE.label} once per group</strong> to take the watermark off every slide of that one group,
        including slides of awards remade later. It isn’t a subscription. The unlock lasts as long as the group: until it
        is deleted, {LIMITS.retentionDays} days after it was made, so it isn’t sold in a group’s last{' '}
        {LIMITS.unlockCutoffDays} days. Payments are handled by Stripe.
      </p>

      <h2>Refunds</h2>
      <p>
        Refund on request, no questions asked: you get the full {UNLOCK_PRICE.label} back. Write to the support address on
        your Stripe receipt.
      </p>

      <h2 id="report">Reports and takedowns</h2>
      <p>
        Every yearbook has a “Report it or ask for a takedown” link at the bottom. It reaches us with the group attached:
        say whose award or photo it is. We read every report and remove what breaks the rules, or a photo of you that you
        want gone. If you only have an invite link, ask the organizer for the yearbook link, or ask them to report it.
      </p>

      <h2>Deletion</h2>
      <p>
        Every group is deleted {LIMITS.retentionDays} days after it was made, with all its answers, photos, awards and
        reports. See <a href="/privacy">privacy</a> for what is stored and who sees it.
      </p>

      <h2>No warranty</h2>
      <p>
        squadwrap is a small app, provided as it is, without warranty of any kind: it may have bugs, the awards may miss
        the mark, and it may change or stop. If it stops before a paid group’s deletion date, ask for a refund as above.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        For anything else, open an issue on <a href={ISSUES_URL}>squadwrap’s GitHub</a>. Issues are public: never post a
        group’s links, anyone’s name or a photo there.
      </p>
    </article>
  )
}
