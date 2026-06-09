'use client'

import { useEffect } from 'react'
import { trackEvent } from '@/lib/analytics'

export default function TrackPageView({ path }: { path: string }) {
  useEffect(() => {
    trackEvent('PAGE_VIEW', path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
