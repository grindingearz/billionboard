import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { utcDayStart, getOrCreateEpoch } from '@/lib/epoch'
import { settleRevenueEvent } from '@/lib/settlement'
import { captureAppError } from '@/lib/sentry'

// GET /api/billing — Vercel cron invokes via GET; delegates to runBilling
export async function GET(req: Request) {
  return runBilling(req)
}

// POST /api/billing — manual trigger from admin UI or direct cron-secret POST
export async function POST(req: Request) {
  return runBilling(req)
}

async function runBilling(req: Request): Promise<Response> {
  const session = await getSession()
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  const adminWallet = env.adminWallet
  const isAdmin = session?.role === 'ADMIN' && !!adminWallet && session.adminWallet === adminWallet
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = utcDayStart(new Date())

  const existing = await prisma.dailyBillingRun.findUnique({ where: { runDate: today } })
  if (existing?.status === 'completed') {
    return NextResponse.json({ error: 'Billing already run today', run: existing }, { status: 409 })
  }
  // Abandoned 'pending' run (server crash mid-billing) — delete and restart cleanly
  if (existing?.status === 'pending') {
    await prisma.dailyBillingRun.delete({ where: { id: existing.id } })
  }

  const now = new Date()

  // Only bill ACTIVE rentals where nextBillingAt is due.
  // Exclude duration-campaign rentals — those are billed via recognize-campaign-revenue cron.
  const activeRentals = await prisma.adRental.findMany({
    where: {
      status: 'ACTIVE',
      AND: [
        { OR: [{ nextBillingAt: null }, { nextBillingAt: { lte: now } }] },
        { OR: [{ creative: null }, { creative: { durationType: null } }] },
      ],
    },
    include: { user: { include: { advertiserWallet: true } } },
  })

  // Group by user
  const byUser = new Map<string, typeof activeRentals>()
  for (const rental of activeRentals) {
    const arr = byUser.get(rental.userId) ?? []
    arr.push(rental)
    byUser.set(rental.userId, arr)
  }

  let totalRevenue = 0
  let tilesCharged = 0
  const suspended: string[] = []
  const billedRentalDetails: Array<{ id: string; currentNextBillingAt: Date | null }> = []
  const revenueEventData: Array<{
    type: 'AD_RENT_REVENUE'
    source: string
    billingRunId: string
    userId: string
    rentalId: string
    epochId: string
    amount: number
  }> = []
  const billingItems: Array<{
    billingRunId: string
    rentalId: string
    billedDate: Date
    amount: number
  }> = []

  const [billingRun, todayEpoch] = await Promise.all([
    prisma.dailyBillingRun.create({ data: { runDate: today, status: 'pending' } }),
    getOrCreateEpoch(today),
  ])

  const billedDate = new Date(today)

  for (const [userId, rentals] of byUser) {
    const wallet = rentals[0].user.advertiserWallet
    if (!wallet) continue

    const chargeCents = rentals.reduce((sum, r) => sum + Math.round(Number(r.dailyRate) * 100), 0)
    const balanceCents = Math.round(Number(wallet.usdcBalance) * 100)

    if (chargeCents > 0 && balanceCents < chargeCents) {
      // Insufficient funds — suspend all active rentals for this user
      for (const r of rentals) {
        suspended.push(r.id)
      }
      continue
    }

    const charge = rentals.reduce((sum, r) => sum + Number(r.dailyRate), 0)
    totalRevenue += charge
    tilesCharged += rentals.length

    for (const r of rentals) {
      billedRentalDetails.push({ id: r.id, currentNextBillingAt: r.nextBillingAt })
      revenueEventData.push({
        type: 'AD_RENT_REVENUE',
        source: 'billing',
        billingRunId: billingRun.id,
        userId,
        rentalId: r.id,
        epochId: todayEpoch.id,
        amount: Number(r.dailyRate),
      })
      billingItems.push({
        billingRunId: billingRun.id,
        rentalId: r.id,
        billedDate,
        amount: Number(r.dailyRate),
      })
    }
  }

  // Apply in transaction
  await prisma.$transaction([
    // Deduct balances (sum of dailyRates per user)
    ...Array.from(byUser.entries())
      .filter(([, rentals]) => {
        const chargeCents = rentals.reduce((sum, r) => sum + Math.round(Number(r.dailyRate) * 100), 0)
        const balanceCents = Math.round(Number(rentals[0].user.advertiserWallet?.usdcBalance ?? 0) * 100)
        return chargeCents === 0 || balanceCents >= chargeCents
      })
      .map(([userId, rentals]) => {
        const charge = rentals.reduce((sum, r) => sum + Number(r.dailyRate), 0)
        return prisma.advertiserWallet.update({
          where: { userId },
          data: { usdcBalance: { decrement: charge } },
        })
      }),
    // Suspend underfunded rentals (soft suspend rather than hard expire)
    ...(suspended.length > 0
      ? [
          prisma.adRental.updateMany({
            where: { id: { in: suspended } },
            data: { status: 'SUSPENDED', endDate: new Date() },
          }),
        ]
      : []),
    // Create BillingItems for per-rental idempotency
    ...(billingItems.length > 0
      ? [prisma.billingItem.createMany({ data: billingItems, skipDuplicates: true })]
      : []),
    // Create AD_RENT_REVENUE events
    ...(revenueEventData.length > 0
      ? [prisma.revenueEvent.createMany({ data: revenueEventData })]
      : []),
    // Advance nextBillingAt for each successfully billed rental
    ...billedRentalDetails.map(({ id, currentNextBillingAt }) => {
      const base = currentNextBillingAt?.getTime() ?? now.getTime()
      return prisma.adRental.update({
        where: { id },
        data: {
          nextBillingAt: new Date(base + 24 * 60 * 60 * 1000),
          lastBilledAt: now,
        },
      })
    }),
    // Update billing run
    prisma.dailyBillingRun.update({
      where: { id: billingRun.id },
      data: { tilesCharged, totalRevenue, status: 'completed' },
    }),
  ])

  // Fire-and-forget settlement for each new revenue event
  if (revenueEventData.length > 0) {
    const createdEvents = await prisma.revenueEvent.findMany({
      where: { billingRunId: billingRun.id, type: 'AD_RENT_REVENUE' },
      select: { id: true },
    })
    for (const ev of createdEvents) {
      void settleRevenueEvent(ev.id).catch((err) => {
        console.error('[settlement] billing error', ev.id, err)
        captureAppError(err, { cronJob: 'billing', revenueEventId: ev.id, route: '/api/billing', status: 'settlement_error' })
      })
    }
  }

  return NextResponse.json({
    ok: true,
    billingRunId: billingRun.id,
    tilesCharged,
    totalRevenue,
    suspendedRentals: suspended.length,
  })
}
