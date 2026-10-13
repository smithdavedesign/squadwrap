'use client'

import { useEffect } from 'react'
import { signalVisit } from '../lib/signal'

/** Counts a visit for RepoHQ once per browser session (lib/signal.ts); renders nothing. */
export function VisitSignal() {
  useEffect(() => {
    signalVisit()
  }, [])
  return null
}
