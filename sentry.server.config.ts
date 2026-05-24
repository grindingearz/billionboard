import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/sentry'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    return scrubSentryEvent(event)
  },
})
