import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TOTAL_TILES } from '@/lib/types'
import { getTilePrice, getSetting } from '@/lib/settings'
import { getOrCreateEpoch, todayUtc, msUntilUtcClose } from '@/lib/epoch'

export async function GET() {
  try {
    const now = new Date()
    const today = todayUtc()
    const todayEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
    )

    const [
      activeTiles,
      pendingTiles,
      activeAdvertisers,
      revenueAgg,
      totalDistributed,
      totalClaimPoolAllocated,
      epochs,
      recentBillingRuns,
      todayAd,
      todayFee,
      tilePrice,
      feePercentStr,
      currentEpoch,
      settledTotal,
      sentToTreasury,
      sentToDistribution,
      pendingSettlements,
      failedSettlements,
    ] = await Promise.all([
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.adRental
        .findMany({ where: { status: 'ACTIVE' }, select: { userId: true }, distinct: ['userId'] })
        .then((rows) => rows.length),
      prisma.revenueEvent.aggregate({
        where: { type: { in: ['AD_RENT_REVENUE', 'TRADING_FEE_REVENUE'] } },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'CLAIM_PAYOUT' },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'CLAIM_POOL_ALLOCATION' },
        _sum: { amount: true },
      }),
      prisma.distributionEpoch.findMany({
        orderBy: { epochDate: 'desc' },
        take: 30,
        select: {
          epochDate: true,
          adRevenue: true,
          tradingFeeRevenue: true,
          grossPool: true,
          managementFeePercent: true,
          managementFeeAmount: true,
          claimPoolAmount: true,
          totalPool: true,
          eligibleSupply: true,
          snapshotDate: true,
          status: true,
        },
      }),
      prisma.dailyBillingRun.findMany({
        orderBy: { runDate: 'desc' },
        take: 7,
        select: { runDate: true, tilesCharged: true, totalRevenue: true, status: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'AD_RENT_REVENUE', createdAt: { gte: today, lte: todayEnd } },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'TRADING_FEE_REVENUE', createdAt: { gte: today, lte: todayEnd } },
        _sum: { amount: true },
      }),
      getTilePrice(),
      getSetting('management_fee_percent'),
      getOrCreateEpoch(today),
      // Settlement aggregates — safe to expose totals publicly (no private keys)
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { amount: true },
      }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { treasuryAmount: true },
      }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { distributionAmount: true },
      }),
      prisma.revenueSettlement.count({
        where: { settlementStatus: 'UNSETTLED' },
      }),
      prisma.revenueSettlement.count({
        where: { settlementStatus: { in: ['FAILED', 'PARTIAL'] } },
      }),
    ])

    const todayAdRevenue = Number(todayAd._sum.amount ?? 0)
    const todayFeeRevenue = Number(todayFee._sum.amount ?? 0)
    const todayGross = todayAdRevenue + todayFeeRevenue
    const feePercent = Math.max(0, Math.min(100, parseFloat(feePercentStr) || 10))
    const todayMgmtFee = todayGross * (feePercent / 100)
    const todayClaimPool = todayGross - todayMgmtFee

    const totalAdFees = Number(revenueAgg._sum.amount ?? 0)

    return NextResponse.json({
      activeTiles,
      pendingTiles,
      availableTiles: TOTAL_TILES - activeTiles - pendingTiles,
      activeAdvertisers,
      // Renamed: "total advertising fees earned" (not "revenue" to avoid confusing with deposited balance)
      totalRevenue: totalAdFees,
      totalAdvertisingFees: totalAdFees,
      totalDistributed: Number(totalDistributed._sum.amount ?? 0),
      totalClaimPoolAllocated: Number(totalClaimPoolAllocated._sum.amount ?? 0),
      tilePrice,
      feePercent,
      msUntilClose: msUntilUtcClose(),
      today: {
        adRevenue: todayAdRevenue,
        feeRevenue: todayFeeRevenue,
        grossPool: todayGross,
        managementFee: todayMgmtFee,
        claimPool: todayClaimPool,
      },
      currentEpoch: {
        epochDate: currentEpoch.epochDate,
        status: currentEpoch.status,
      },
      epochs,
      recentBillingRuns,
      // Settlement totals (public — no private wallet details)
      settlement: {
        totalSettled: Number(settledTotal._sum.amount ?? 0),
        totalSentToTreasury: Number(sentToTreasury._sum.treasuryAmount ?? 0),
        totalSentToDistribution: Number(sentToDistribution._sum.distributionAmount ?? 0),
        pendingSettlements,
        failedSettlements,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
