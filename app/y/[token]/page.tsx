import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getDb } from '../../../lib/api'
import { formatDay } from '../../../lib/prompts'
import { getYearbook, yearbookFilePath, yearbookPath } from '../../../lib/squad'

export const metadata: Metadata = {
  title: 'Yearbook · squadwrap',
  // A private link: never in search results. next.config sends the same as an X-Robots-Tag header.
  robots: { index: false, follow: false },
}

/** The group's yearbook: every award with its photo and slide. Anyone with the link can see it, nobody can edit. */
export default async function YearbookPage({ params }: { params: Promise<{ token: string }> }) {
  await connection()
  const { token } = await params
  const yearbook = await getYearbook(await getDb(), token)
  if (!yearbook) notFound()

  return (
    <>
      <h1>
        {yearbook.name} <span className="muted">{yearbook.year} yearbook</span>
      </h1>
      {yearbook.awards.length === 0 ? (
        <section className="card">
          <p>The awards aren’t ready yet. Check back once the organizer has made them.</p>
        </section>
      ) : (
        <>
          <p className="lead">
            One award per friend, made from what everyone answered. Save your slide and post the image, not its link: the
            link opens this whole page.
          </p>
          {!yearbook.unlocked && <p className="muted small">Free slides carry a “preview” watermark.</p>}
          <ul className="awards">
            {yearbook.awards.map((award) => (
              <li className="award yearbook-award" key={award.displayName}>
                {award.hasPhoto ? (
                  <img className="avatar" src={yearbookFilePath(token, award.displayName, 'jpg')} alt={award.displayName} />
                ) : (
                  <span className="avatar" aria-hidden="true">
                    {Array.from(award.displayName)[0]?.toLocaleUpperCase()}
                  </span>
                )}
                <div>
                  <p className="award-name">{award.displayName}</p>
                  <p className="award-title">{award.title}</p>
                  <p>{award.citation}</p>
                  <a
                    className="button-link"
                    href={yearbookFilePath(token, award.displayName, 'png')}
                    download={`squadwrap-${award.displayName}.png`}
                    aria-label={`Download ${award.displayName}’s slide`}
                  >
                    Download slide
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <footer className="page-footer muted small">
        <p>This yearbook, with every photo and slide in it, is deleted on {formatDay(yearbook.deletesOn)}.</p>
        <p>
          <a href="/">Make your own group’s wrap</a>
        </p>
        <p>
          Something here that shouldn’t be? <a href={`${yearbookPath(token)}/report`}>Report it or ask for a takedown</a>.
        </p>
      </footer>
    </>
  )
}
