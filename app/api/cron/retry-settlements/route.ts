import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { settleRevenueEvent } from '@/lib/settlement'
import { captureAppError } from '@/lib/sentry'

function authorized(req: Request): boolean {
  const secret = env.cronSecret
  if (!secret && process.env.NODE_ENV === 'production') return false
  return !secret || req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  const pending = await prisma.revenueSettlement.findMany({
    where: {
      retryable: true,
      nextRetryAt: { lte: now },
      settlementStatus: { not: 'SETTLED' },
    },
    select: { id: true, revenueEventId: true, retryCount: true, settlementStatus: true },
    orderBy: { nextRetryAt: 'asc' },
    take: 50,
  })

  if (pending.length === 0) {
    return NextResponse.json({ retried: 0, results: [] })
  }

  const results: Array<{
    settlementId: string
    revenueEventId: string
    status: string
    ok: boolean
    error?: string
  }> = []

  for (const record of pending) {
    try {
      const result = await settleRevenueEvent(record.revenueEventId)
      results.push({
        settlementId: record.id,
        revenueEventId: record.revenueEventId,
        status: result.status,
        ok: result.ok,
        error: result.error,
      })
    } catch (err) {
      captureAppError(err, {
        cronJob: 'retry-settlements',
        settlementId: record.id,
        revenueEventId: record.revenueEventId,
        status: 'ERROR',
        retryCount: record.retryCount,
      })
      results.push({
        settlementId: record.id,
        revenueEventId: record.revenueEventId,
        status: 'ERROR',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const succeeded = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length

  return NextResponse.json({ retried: results.length, succeeded, failed, results })
}

export async function POST(req: Request) {
  return GET(req)
}
