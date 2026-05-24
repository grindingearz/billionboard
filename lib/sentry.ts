/**
 * Sentry helper for BillionBoard.
 *
 * NEVER pass private keys, session secrets, JWTs, cookies, or env secrets as context.
 * This module is safe to import server-side only.
 */
import * as Sentry from '@sentry/nextjs'

export type AppErrorContext = {
  route?: string
  cronJob?: string
  settlementId?: string
  revenueEventId?: string
  claimId?: string
  epochId?: string
  creativeId?: string
  retryCount?: number
  status?: string
  extra?: Record<string, unknown>
}

/** Patterns that must never appear as tag or extra values in Sentry events. */
const SENSITIVE_KEY_PATTERNS = [
  /private[_\s]?key/i,
  /secret/i,
  /jwt/i,
  /token/i,
  /cookie/i,
  /authorization/i,
  /password/i,
  /session/i,
  /cron[_\s]?secret/i,
  /wallet[_\s]?key/i,
]

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k)) {
      out[k] = '[Filtered]'
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrubObject(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

/** Scrub a Sentry event before sending. Applied in both client and server configs. */
export function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.extra) event.extra = scrubObject(event.extra as Record<string, unknown>)
  if (event.tags) {
    const tags: Record<string, string> = {}
    for (const [k, v] of Object.entries(event.tags)) {
      tags[k] = isSensitiveKey(k) ? '[Filtered]' : String(v)
    }
    event.tags = tags
  }
  if (event.request) {
    if (event.request.headers) {
      const h = event.request.headers as Record<string, string>
      if (h['authorization']) h['authorization'] = '[Filtered]'
      if (h['cookie']) h['cookie'] = '[Filtered]'
      if (h['set-cookie']) h['set-cookie'] = '[Filtered]'
    }
    // Never send request body — may contain wallet key material
    delete event.request.data
  }
  return event
}

/**
 * Capture an application error with safe, structured context.
 * Never pass private keys, secrets, or JWTs as context values.
 */
export function captureAppError(
  error: unknown,
  context?: AppErrorContext
): void {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return

  Sentry.withScope((scope) => {
    if (context?.route) scope.setTag('route', context.route)
    if (context?.cronJob) scope.setTag('cron_job', context.cronJob)
    if (context?.status) scope.setTag('status', context.status)
    if (context?.settlementId) scope.setTag('settlement_id', context.settlementId)
    if (context?.revenueEventId) scope.setTag('revenue_event_id', context.revenueEventId)
    if (context?.claimId) scope.setTag('claim_id', context.claimId)
    if (context?.epochId) scope.setTag('epoch_id', context.epochId)
    if (context?.creativeId) scope.setTag('creative_id', context.creativeId)
    if (context?.retryCount !== undefined) scope.setTag('retry_count', String(context.retryCount))

    if (context?.extra) {
      const safeExtra = scrubObject(context.extra)
      scope.setExtras(safeExtra)
    }

    if (error instanceof Error) {
      Sentry.captureException(error)
    } else {
      Sentry.captureException(new Error(String(error)))
    }
  })
}
