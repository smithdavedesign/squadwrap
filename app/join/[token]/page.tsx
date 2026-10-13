import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getDb } from '../../../lib/api'
import { getInvite } from '../../../lib/squad'
import { SubmissionForm } from './submission-form'

export const metadata: Metadata = {
  title: 'You’re invited · squadwrap',
  robots: { index: false, follow: false },
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  await connection()
  const { token } = await params
  const invite = await getInvite(await getDb(), token)
  if (!invite) notFound()

  return (
    <>
      <h1>
        {invite.name}: {invite.year}, wrapped
      </h1>
      <p className="lead">
        Answer five quick prompts and add a photo if you like. Everyone’s answers turn into everyone’s awards, so be
        honest and nice-ish.
      </p>
      <SubmissionForm token={token} />
    </>
  )
}
