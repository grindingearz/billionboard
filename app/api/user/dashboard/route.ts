import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

function getDomain(url: string): string {
  try { return new URL(url).hostname } catch { return url.replace(/^https?:\/\//, '').split('/')[0] }
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [user, wallet, activeRentals, pendingAdsCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { walletAddress: true },
    }),
    prisma.advertiserWallet.findUnique({
      where: { userId: session.userId },
      select: { usdcBalance: true },
    }),
    prisma.adRental.findMany({
      where: { userId: session.userId, status: 'ACTIVE' },
      include: { creative: { select: { destUrl: true, displayMode: true } } },
      orderBy: { startDate: 'desc' },
    }),
    prisma.adRental.count({
      where: { userId: session.userId, status: 'PENDING_APPROVAL' },
    }),
  ])

  const balance = Number(wallet?.usdcBalance ?? 0)
  const activeTiles = activeRentals.length
  const dailyBurn = activeRentals.reduce((sum, r) => sum + Number(r.dailyRate), 0)
  const runwayDays = dailyBurn > 0 ? balance / dailyBurn : null

  // Earliest nextBillingAt across all active rentals
  const nextBillingAtMs = activeRentals
    .filter((r) => r.nextBillingAt != null)
    .map((r) => r.nextBillingAt!.getTime())
    .sort((a, b) => a - b)[0] ?? null

  // Group by creativeId to produce per-ad summary
  type AdAcc = {
    destUrl: string
    displayMode: string
    tileCount: number
    dailyRate: number
    activatedAt: Date | null
    nextBillingAt: Date | null
  }
  const byCreative = new Map<string, AdAcc>()
  for (const r of activeRentals) {
    const key = r.creativeId ?? `solo-${r.id}`
    const existing = byCreative.get(key)
    if (!existing) {
      byCreative.set(key, {
        destUrl: r.creative?.destUrl ?? '',
        displayMode: r.creative?.displayMode ?? 'REPEAT',
        tileCount: 1,
        dailyRate: Number(r.dailyRate),
        activatedAt: r.startDate,
        nextBillingAt: r.nextBillingAt,
      })
    } else {
      existing.tileCount++
      existing.dailyRate += Number(r.dailyRate)
    }
  }

  const ads = Array.from(byCreative.entries()).map(([id, ad]) => ({
    id,
    destinationDomain: getDomain(ad.destUrl),
    tileCount: ad.tileCount,
    displayMode: ad.displayMode,
    dailyRate: ad.dailyRate,
    status: 'ACTIVE',
    activatedAt: ad.activatedAt?.toISOString() ?? null,
    nextBillingAt: ad.nextBillingAt?.toISOString() ?? null,
  }))

  return NextResponse.json({
    balance,
    walletAddress: user?.walletAddress ?? null,
    activeAdsCount: byCreative.size,
    pendingAdsCount,
    activeTiles,
    dailyBurn,
    runwayDays,
    nextBillingAt: nextBillingAtMs ? new Date(nextBillingAtMs).toISOString() : null,
    ads,
  })
}
