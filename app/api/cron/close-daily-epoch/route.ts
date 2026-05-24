import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { yesterdayUtc, closeEpochForDate } from '@/lib/epoch'

// GET /api/cron/close-daily-epoch — Vercel cron invokes via GET
export async function GET(req: Request) {
  return runCloseEpoch(req)
}

// POST /api/cron/close-daily-epoch — manual trigger from admin UI or cron-secret POST
// Body (optional): { epochDate: "<ISO date>" } — defaults to yesterday UTC
export async function POST(req: Request) {
  return runCloseEpoch(req)
}

async function runCloseEpoch(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization')
  const cronSecret = env.cronSecret
  const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)

  if (!isCron) {
    const session = await getSession()
    const adminWallet = env.adminWallet
    const isAdmin = session?.role === 'ADMIN' && !!adminWallet && session.adminWallet === adminWallet
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let targetDate: Date
  try {
    const body = await req.json()
    targetDate = body.epochDate ? new Date(body.epochDate) : yesterdayUtc()
  } catch {
    targetDate = yesterdayUtc()
  }

  try {
    const epoch = await closeEpochForDate(targetDate)
    return NextResponse.json({ ok: true, epoch })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
