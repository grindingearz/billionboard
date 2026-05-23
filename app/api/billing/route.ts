import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'

// POST /api/billing — trigger daily billing run (admin or cron secret)
export async function POST(req: Request) {
  const session = await getSession()
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  const adminWallet = env.adminWallet
  const isAdmin = session?.role === 'ADMIN' && !!adminWallet && session.adminWallet === adminWallet
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const existing = await prisma.dailyBillingRun.findUnique({ where: { runDate: today } })
  if (existing) {
    return NextResponse.json({ error: 'Billing already run today', run: existing }, { status: 409 })
  }

  const activeRentals = await prisma.adRental.findMany({
    where: { status: 'ACTIVE' },
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
  const expired: string[] = []
  const revenueEvents: Array<{
    type: 'AD_RENT_REVENUE'
    source: string
    billingRunId: string
    userId: string
    rentalId: string
    amount: number
  }> = []
  const billingItems: Array<{
    billingRunId: string
    rentalId: string
    billedDate: Date
    amount: number
  }> = []

  const billingRun = await prisma.dailyBillingRun.create({
    data: { runDate: today, status: 'pending' },
  })

  // billedDate is the calendar date only (no time), used for BillingItem @@unique
  const billedDate = new Date(today)

  for (const [userId, rentals] of byUser) {
    const wallet = rentals[0].user.advertiserWallet
    if (!wallet) continue

    // Use each rental's stored dailyRate (set at submission time)
    const charge = rentals.reduce((sum, r) => sum + Number(r.dailyRate), 0)
    const balance = Number(wallet.usdcBalance)

    if (charge > 0 && balance < charge) {
      // Insufficient funds — expire all active rentals for this user
      for (const r of rentals) {
        expired.push(r.id)
      }
      continue
    }

    totalRevenue += charge
    tilesCharged += rentals.length

    for (const r of rentals) {
      revenueEvents.push({
        type: 'AD_RENT_REVENUE',
        source: 'billing',
        billingRunId: billingRun.id,
        userId,
        rentalId: r.id,
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
        const charge = rentals.reduce((sum, r) => sum + Number(r.dailyRate), 0)
        const balance = Number(rentals[0].user.advertiserWallet?.usdcBalance ?? 0)
        return charge === 0 || balance >= charge
      })
      .map(([userId, rentals]) => {
        const charge = rentals.reduce((sum, r) => sum + Number(r.dailyRate), 0)
        return prisma.advertiserWallet.update({
          where: { userId },
          data: { usdcBalance: { decrement: charge } },
        })
      }),
    // Expire underfunded rentals
    ...(expired.length > 0
      ? [
          prisma.adRental.updateMany({
            where: { id: { in: expired } },
            data: { status: 'EXPIRED', endDate: new Date() },
          }),
        ]
      : []),
    // Create BillingItems for per-rental idempotency (skipDuplicates guards against any race)
    ...(billingItems.length > 0
      ? [prisma.billingItem.createMany({ data: billingItems, skipDuplicates: true })]
      : []),
    // Create typed AD_RENT_REVENUE events
    ...(revenueEvents.length > 0
      ? [prisma.revenueEvent.createMany({ data: revenueEvents })]
      : []),
    // Update billing run
    prisma.dailyBillingRun.update({
      where: { id: billingRun.id },
      data: { tilesCharged, totalRevenue, status: 'completed' },
    }),
  ])

  return NextResponse.json({
    ok: true,
    billingRunId: billingRun.id,
    tilesCharged,
    totalRevenue,
    expiredRentals: expired.length,
  })
}
