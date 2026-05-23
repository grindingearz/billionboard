import { prisma } from './prisma'
import { Prisma } from '@/app/generated/prisma/client'

export type RevenueEventType =
  | 'TOPUP_DEPOSIT'
  | 'AD_RENT_REVENUE'
  | 'TRADING_FEE_REVENUE'
  | 'MANAGEMENT_FEE'
  | 'CLAIM_POOL_ALLOCATION'
  | 'CLAIM_PAYOUT'
  | 'MANUAL_ADJUSTMENT'

export async function createRevenueEvent(data: {
  type: RevenueEventType
  source: string
  amount: Prisma.Decimal | number
  currency?: string
  wallet?: string | null
  txSignature?: string | null
  billingRunId?: string | null
  userId?: string | null
  rentalId?: string | null
  epochId?: string | null
  metadata?: Record<string, unknown> | null
}) {
  return prisma.revenueEvent.create({
    data: {
      type: data.type,
      source: data.source,
      amount: data.amount,
      currency: data.currency ?? 'USDC',
      wallet: data.wallet ?? null,
      txSignature: data.txSignature ?? null,
      billingRunId: data.billingRunId ?? null,
      userId: data.userId ?? null,
      rentalId: data.rentalId ?? null,
      epochId: data.epochId ?? null,
      metadata: data.metadata
        ? (data.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  })
}

/** Sum gross revenue (AD_RENT_REVENUE + TRADING_FEE_REVENUE) for a given UTC calendar day. */
export async function getGrossRevenueForDate(date: Date): Promise<{
  adRevenue: number
  tradingFeeRevenue: number
  grossPool: number
}> {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))

  const [ad, fee] = await Promise.all([
    prisma.revenueEvent.aggregate({
      where: { type: 'AD_RENT_REVENUE', createdAt: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
    prisma.revenueEvent.aggregate({
      where: { type: 'TRADING_FEE_REVENUE', createdAt: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
  ])

  const adRevenue = Number(ad._sum.amount ?? 0)
  const tradingFeeRevenue = Number(fee._sum.amount ?? 0)
  return { adRevenue, tradingFeeRevenue, grossPool: adRevenue + tradingFeeRevenue }
}
