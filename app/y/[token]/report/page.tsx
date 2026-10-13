import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getDb } from '../../../../lib/api'
import { getYearbookGroup, yearbookPath } from '../../../../lib/squad'
import { ReportForm } from './report-form'

export const metadata: Metadata = {
  title: 'Report a yearbook · squadwrap',
  robots: { index: false, follow: false },
}

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  await connection()
  const { token } = await params
  const group = await getYearbookGroup(await getDb(), token)
  if (!group) notFound()

  return (
    <>
      <h1>Report this yearbook</h1>
      <p className="lead">
        {group.name}, {group.year}
      </p>
      <p>
        Tell us what’s wrong: an award that goes too far, a photo of you that you want taken down, or anything about a
        minor, health, abuse or money. We read every report and take down what breaks the rules.
      </p>
      <ReportForm token={token} />
      <p className="small">
        <a href={yearbookPath(token)}>Back to the yearbook</a>
      </p>
    </>
  )
}
