import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/sentry'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend(event) {
    return scrubSentryEvent(event)
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data?.headers) delete breadcrumb.data.headers
    return breadcrumb
  },
})
