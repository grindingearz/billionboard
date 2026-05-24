import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, walletMismatch } from '@/lib/auth'

function getDomain(url: string): string {
  try { return new URL(url).hostname } catch { return url.replace(/^https?:\/\//, '').split('/')[0] }
}

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (walletMismatch(session, req)) return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 })

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
      include: {
        creative: {
          select: {
            destUrl: true,
            displayMode: true,
            durationType: true,
            durationDays: true,
            totalPrice: true,
            recognizedAmount: true,
            dailyRecognizedRevenue: true,
            campaignStartAt: true,
            campaignEndAt: true,
            autoRenew: true,
            renewalCount: true,
            campaignStatus: true,
          },
        },
      },
      orderBy: { startDate: 'desc' },
    }),
    prisma.adRental.count({
      where: { userId: session.userId, status: 'PENDING_APPROVAL' },
    }),
  ])

  const balance = Number(wallet?.usdcBalance ?? 0)
  const activeTiles = activeRentals.length

  // For legacy per-day rentals, compute daily burn from dailyRate
  // For campaign rentals, dailyRecognizedRevenue is already the per-campaign daily cost
  const legacyBurn = activeRentals
    .filter((r) => !r.creative?.durationType)
    .reduce((sum, r) => sum + Number(r.dailyRate), 0)
  const dailyBurn = legacyBurn
  const runwayDays = dailyBurn > 0 ? balance / dailyBurn : null

  const nextBillingAtMs = activeRentals
    .filter((r) => r.nextBillingAt != null)
    .map((r) => r.nextBillingAt!.getTime())
    .sort((a, b) => a - b)[0] ?? null

  // Group by creativeId
  type AdAcc = {
    creativeId: string
    destUrl: string
    displayMode: string
    tileCount: number
    dailyRate: number
    activatedAt: Date | null
    nextBillingAt: Date | null
    // campaign fields
    durationType: string | null
    durationDays: number | null
    totalPrice: number | null
    recognizedAmount: number | null
    dailyRecognizedRevenue: number | null
    campaignStartAt: Date | null
    campaignEndAt: Date | null
    autoRenew: boolean
    renewalCount: number
    campaignStatus: string | null
  }
  const byCreative = new Map<string, AdAcc>()
  for (const r of activeRentals) {
    const key = r.creativeId ?? `solo-${r.id}`
    const existing = byCreative.get(key)
    if (!existing) {
      byCreative.set(key, {
        creativeId: r.creativeId ?? key,
        destUrl: r.creative?.destUrl ?? '',
        displayMode: r.creative?.displayMode ?? 'REPEAT',
        tileCount: 1,
        dailyRate: Number(r.dailyRate),
        activatedAt: r.startDate,
        nextBillingAt: r.nextBillingAt,
        durationType: r.creative?.durationType ?? null,
        durationDays: r.creative?.durationDays ?? null,
        totalPrice: r.creative?.totalPrice != null ? Number(r.creative.totalPrice) : null,
        recognizedAmount: r.creative?.recognizedAmount != null ? Number(r.creative.recognizedAmount) : null,
        dailyRecognizedRevenue: r.creative?.dailyRecognizedRevenue != null ? Number(r.creative.dailyRecognizedRevenue) : null,
        campaignStartAt: r.creative?.campaignStartAt ?? null,
        campaignEndAt: r.creative?.campaignEndAt ?? null,
        autoRenew: r.creative?.autoRenew ?? true,
        renewalCount: r.creative?.renewalCount ?? 0,
        campaignStatus: r.creative?.campaignStatus ?? null,
      })
    } else {
      existing.tileCount++
      existing.dailyRate += Number(r.dailyRate)
    }
  }

  const ads = Array.from(byCreative.values()).map((ad) => ({
    id: ad.creativeId,
    destinationDomain: getDomain(ad.destUrl),
    tileCount: ad.tileCount,
    displayMode: ad.displayMode,
    dailyRate: ad.dailyRate,
    status: 'ACTIVE',
    activatedAt: ad.activatedAt?.toISOString() ?? null,
    nextBillingAt: ad.nextBillingAt?.toISOString() ?? null,
    // campaign-specific
    durationType: ad.durationType,
    durationDays: ad.durationDays,
    totalPrice: ad.totalPrice,
    recognizedAmount: ad.recognizedAmount,
    dailyRecognizedRevenue: ad.dailyRecognizedRevenue,
    unrecognizedAmount: ad.totalPrice != null && ad.recognizedAmount != null
      ? Math.max(0, ad.totalPrice - ad.recognizedAmount)
      : null,
    campaignStartAt: ad.campaignStartAt?.toISOString() ?? null,
    campaignEndAt: ad.campaignEndAt?.toISOString() ?? null,
    autoRenew: ad.autoRenew,
    renewalCount: ad.renewalCount,
    campaignStatus: ad.campaignStatus,
    nextRenewalCost: ad.totalPrice,
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
