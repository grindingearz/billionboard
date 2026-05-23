import { prisma } from './prisma'
import { env } from './env'
import { getGrossRevenueForDate, createRevenueEvent } from './revenue'
import { fetchTokenHolders } from './helius'
import { getSetting } from './settings'

// ── UTC helpers ─────────────────────────────────────────────────────────────

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function utcDayEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))
}

export function todayUtc(): Date {
  return utcDayStart(new Date())
}

export function yesterdayUtc(): Date {
  const d = new Date()
  return utcDayStart(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1)))
}

export function formatUtcDate(date: Date | string): string {
  const d = new Date(date)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day} UTC`
}

export function msUntilUtcClose(): number {
  const now = Date.now()
  const nextMidnight = utcDayStart(new Date(now + 86400000)).getTime()
  return nextMidnight - now
}

// ── Epoch lifecycle ──────────────────────────────────────────────────────────

/** Get or auto-create the OPEN epoch for a given UTC calendar day. */
export async function getOrCreateEpoch(date: Date) {
  const epochDate = utcDayStart(date)
  return prisma.distributionEpoch.upsert({
    where: { epochDate },
    create: {
      epochDate,
      startTime: epochDate,
      endTime: utcDayEnd(date),
      status: 'OPEN',
    },
    update: {},
  })
}

/**
 * Close a UTC calendar day's epoch end-to-end:
 *   OPEN/DRAFT/BILLED/FAILED → PROCESSING → BILLED → SNAPSHOTTED → PUBLISHED
 *   If BOARD_MINT is unset          → READY_NO_TOKEN
 *   On any error                    → FAILED (then rethrows)
 *
 * Idempotent: already PUBLISHED, CLOSED, or READY_NO_TOKEN epochs are
 * returned as-is without modification.
 */
export async function closeEpochForDate(date: Date) {
  const epochDate = utcDayStart(date)

  let epoch = await prisma.distributionEpoch.upsert({
    where: { epochDate },
    create: {
      epochDate,
      startTime: epochDate,
      endTime: utcDayEnd(date),
      status: 'OPEN',
    },
    update: {},
  })

  if (
    epoch.status === 'PUBLISHED' ||
    epoch.status === 'CLOSED' ||
    epoch.status === 'READY_NO_TOKEN'
  ) {
    return epoch
  }

  epoch = await prisma.distributionEpoch.update({
    where: { id: epoch.id },
    data: { status: 'PROCESSING' },
  })

  try {
    // 1. Revenue calculation
    const feePercentStr = await getSetting('management_fee_percent')
    const feePercent = parseFloat(feePercentStr)

    const { adRevenue, tradingFeeRevenue, grossPool } = await getGrossRevenueForDate(epochDate)
    const managementFeeAmount = (grossPool * feePercent) / 100
    const claimPoolAmount = grossPool - managementFeeAmount

    if (managementFeeAmount > 0) {
      await createRevenueEvent({
        type: 'MANAGEMENT_FEE',
        source: 'cron',
        amount: managementFeeAmount,
        epochId: epoch.id,
        metadata: { feePercent, grossPool },
      })
    }
    if (claimPoolAmount > 0) {
      await createRevenueEvent({
        type: 'CLAIM_POOL_ALLOCATION',
        source: 'cron',
        amount: claimPoolAmount,
        epochId: epoch.id,
        metadata: { adRevenue, tradingFeeRevenue, grossPool, feePercent },
      })
    }

    epoch = await prisma.distributionEpoch.update({
      where: { id: epoch.id },
      data: {
        adRevenue,
        tradingFeeRevenue,
        grossPool,
        managementFeePercent: feePercent,
        managementFeeAmount,
        claimPoolAmount,
        totalPool: claimPoolAmount,
        status: 'BILLED',
      },
    })

    // 2. Holder snapshot (requires BOARD_MINT)
    const boardMint = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''
    if (!boardMint) {
      epoch = await prisma.distributionEpoch.update({
        where: { id: epoch.id },
        data: { status: 'READY_NO_TOKEN', publishedAt: new Date() },
      })
      return epoch
    }

    const heliusApiKey = env.heliusApiKey
    if (!heliusApiKey) {
      epoch = await prisma.distributionEpoch.update({
        where: { id: epoch.id },
        data: { status: 'FAILED' },
      })
      return epoch
    }

    const excluded = await prisma.excludedWallet.findMany({ select: { walletAddress: true } })
    const excludedSet = new Set(excluded.map((e) => e.walletAddress))
    const holders = await fetchTokenHolders(boardMint, heliusApiKey)
    const eligibleHolders = holders.filter((h) => !excludedSet.has(h.walletAddress))
    const totalSupply = eligibleHolders.reduce((sum, h) => sum + BigInt(h.balance), 0n)

    await prisma.$transaction([
      prisma.distributionEpoch.update({
        where: { id: epoch.id },
        data: {
          status: 'SNAPSHOTTED',
          snapshotDate: new Date(),
          eligibleSupply: totalSupply.toString(),
        },
      }),
      ...eligibleHolders.map((h) =>
        prisma.holderSnapshot.upsert({
          where: { epochId_walletAddress: { epochId: epoch.id, walletAddress: h.walletAddress } },
          update: { tokenBalance: h.balance },
          create: {
            epochId: epoch.id,
            walletAddress: h.walletAddress,
            tokenBalance: h.balance,
            claimAmount:
              totalSupply > 0n
                ? (Number(BigInt(h.balance) * BigInt(Math.round(claimPoolAmount * 1e6))) /
                    Number(totalSupply)) /
                  1e6
                : 0,
          },
        })
      ),
    ])

    // 3. Publish
    epoch = await prisma.distributionEpoch.update({
      where: { id: epoch.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })

    return epoch
  } catch (err) {
    await prisma.distributionEpoch.update({
      where: { id: epoch.id },
      data: { status: 'FAILED' },
    })
    throw err
  }
}
