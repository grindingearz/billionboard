import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { yesterdayUtc, closeEpochForDate } from '@/lib/epoch'

// POST /api/cron/close-daily-epoch
// Auth: Bearer CRON_SECRET header, OR admin session
// Body (optional): { epochDate: "<ISO date>" } — defaults to yesterday UTC
export async function POST(req: Request) {
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
