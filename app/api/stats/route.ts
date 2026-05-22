import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const [activeTiles, pendingTiles, totalRevenue, latestEpoch, recentBillingRuns] =
    await Promise.all([
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.revenueEvent.aggregate({ _sum: { amount: true } }),
      prisma.distributionEpoch.findFirst({
        orderBy: { epochDate: 'desc' },
        select: { epochDate: true, totalPool: true, status: true },
      }),
      prisma.dailyBillingRun.findMany({
        orderBy: { runDate: 'desc' },
        take: 7,
        select: { runDate: true, tilesCharged: true, totalRevenue: true, status: true },
      }),
    ])

  return NextResponse.json({
    activeTiles,
    pendingTiles,
    availableTiles: 100000 - activeTiles - pendingTiles,
    totalRevenue: totalRevenue._sum.amount ?? 0,
    latestEpoch,
    recentBillingRuns,
  })
}
