import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getDb } from '../../../lib/api'
import { LIMITS, UNLOCK_PRICE, formatDay, tooLateToUnlock } from '../../../lib/prompts'
import { getDashboard, yearbookFilePath, yearbookPath } from '../../../lib/squad'
import { CopyLink, GenerateButton, Nudge, PaymentPending, UnlockButton } from './dashboard-actions'

export const metadata: Metadata = {
  title: 'Your group · squadwrap',
  robots: { index: false, follow: false },
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function GroupPage({ params, searchParams }: Props) {
  await connection()
  const { id } = await params
  // Stripe Checkout sends the organizer back here with ?paid=1 (lib/payments.ts).
  const backFromCheckout = (await searchParams).paid === '1'
  const group = await getDashboard(await getDb(), id)
  if (!group) notFound()

  const answered = group.submissions.length
  const invitePath = `/join/${group.inviteToken}`
  return (
    <>
      <h1>
        {group.name} <span className="muted">{group.year}</span>
      </h1>
      <p className="warning">
        This page is your organizer link: bookmark it and keep it to yourself. Share the invite link below instead.
      </p>
      <p className="muted small">
        Everything in this group (answers, photos, awards) is deleted on <strong>{formatDay(group.deletesOn)}</strong>,{' '}
        {LIMITS.retentionDays} days after you made it. Save the slides you want to keep before then.
      </p>

      <section className="card">
        <h2>1. Invite the group</h2>
        <p className="muted">Drop this link in the group chat. Friends answer five prompts, with no app and no account.</p>
        <CopyLink path={invitePath} label="Invite link" />
      </section>

      <section className="card">
        <h2>
          2. Who answered ({answered}
          {group.memberCount ? ` of ${group.memberCount}` : ''})
        </h2>
        {answered === 0 && !group.pending ? (
          <p className="muted">No answers yet.</p>
        ) : (
          <ul className="names">
            {group.submissions.map((s) => (
              <li key={s.displayName}>{s.displayName}</li>
            ))}
            {/* There is no roster, only a count: one placeholder per friend still to answer. */}
            {Array.from({ length: group.pending ?? 0 }, (_, i) => (
              <li key={i} className="pending" aria-label="Not answered yet">
                ?
              </li>
            ))}
          </ul>
        )}
        <Nudge
          groupName={group.name}
          year={group.year}
          answered={group.submissions.map((s) => s.displayName)}
          memberCount={group.memberCount}
          invitePath={invitePath}
        />
      </section>

      <section className="card">
        <h2>3. Make the awards</h2>
        <GenerateButton
          groupId={group.id}
          missing={Math.max(0, LIMITS.minSubmissionsToGenerate - answered)}
          hasAwards={group.awards.length > 0}
        />
        {group.awards.length > 0 && (
          <>
            <p className="muted small">
              Every award comes as a story-sized slide (1080×1920) to post or drop in the chat. Post the saved image,
              not the slide’s link: the link opens the whole yearbook.
            </p>
            <div className="unlock">
              {group.unlocked ? (
                <p>
                  <strong>Unlocked:</strong> every slide in this group comes without the watermark. Thanks for chipping
                  in!
                </p>
              ) : backFromCheckout ? (
                <PaymentPending groupId={group.id} />
              ) : tooLateToUnlock(group.createdAt) ? (
                <p>
                  Free slides carry a “PREVIEW” watermark. This group is too close to its deletion on{' '}
                  {formatDay(group.deletesOn)} to unlock it; save the slides you want before then.
                </p>
              ) : (
                <>
                  <p>
                    Free slides carry a “PREVIEW” watermark. Take it off every slide in this group, remakes included:{' '}
                    <strong>{UNLOCK_PRICE.label}</strong>, once. Payment by Stripe; see the <a href="/terms">terms</a>.
                  </p>
                  <UnlockButton groupId={group.id} />
                </>
              )}
            </div>
            <ul className="awards">
              {group.awards.map((award) => (
                <li className="award" key={award.displayName}>
                  <p className="award-name">{award.displayName}</p>
                  <p className="award-title">{award.title}</p>
                  <p>{award.citation}</p>
                  {/* Under the yearbook link, so a shared slide URL never carries the organizer key. */}
                  <a
                    className="button-link"
                    href={yearbookFilePath(group.yearbookToken, award.displayName, 'png')}
                    download={`squadwrap-${award.displayName}.png`}
                    aria-label={`Download ${award.displayName}’s slide`}
                  >
                    Download slide
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {group.awards.length > 0 && (
        <section className="card">
          <h2>4. Share the yearbook</h2>
          <p className="muted">
            Everyone’s awards, photos and slides on one page. Anyone with the link can see it, so share it with the group
            only.
          </p>
          <CopyLink path={yearbookPath(group.yearbookToken)} label="Yearbook link" />
          <p className="small">
            <a href={yearbookPath(group.yearbookToken)}>Open the yearbook</a>
          </p>
        </section>
      )}
    </>
  )
}
