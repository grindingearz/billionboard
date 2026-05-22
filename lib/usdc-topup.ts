import { prisma } from './prisma'
import { env } from './env'

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const TOPUP_EXPIRY_HOURS = 24

export interface HeliusTokenTransfer {
  fromUserAccount: string
  toUserAccount: string
  mint: string
  tokenAmount: number
}

export interface HeliusTransaction {
  signature: string
  tokenTransfers?: HeliusTokenTransfer[]
  [key: string]: unknown
}

export function getDepositWallet(): string | null {
  return env.adRevenueWallet
}

export function parseUsdcTransfers(
  tx: HeliusTransaction,
  depositWallet: string
): HeliusTokenTransfer[] {
  return (tx.tokenTransfers ?? []).filter(
    (t) => t.mint === USDC_MINT && t.toUserAccount === depositWallet
  )
}

/**
 * Credit a USDC transfer to the matching pending topup, or record as unmatched.
 * Idempotent — duplicate signatures are no-ops.
 */
export async function processUsdcTransfer(
  signature: string,
  senderWallet: string,
  receiverWallet: string,
  amountUsdc: number,
  source: 'webhook' | 'reconcile',
  rawPayload?: string
): Promise<{ topupId: string | null; matched: boolean }> {
  const existing = await prisma.processedTransaction.findUnique({ where: { signature } })
  if (existing) return { topupId: existing.topupId, matched: !!existing.topupId }

  const pendingTopup = await prisma.topup.findFirst({
    where: {
      advertiserWallet: senderWallet,
      depositWallet: receiverWallet,
      status: 'PENDING',
      method: 'usdc_solana',
    },
    orderBy: { createdAt: 'asc' },
  })

  if (pendingTopup) {
    await prisma.$transaction([
      prisma.topup.update({
        where: { id: pendingTopup.id },
        data: {
          status: 'CONFIRMED',
          txSignature: signature,
          actualAmount: amountUsdc,
          rawPayload,
          confirmedAt: new Date(),
        },
      }),
      prisma.advertiserWallet.upsert({
        where: { userId: pendingTopup.userId },
        create: { userId: pendingTopup.userId, usdcBalance: amountUsdc },
        update: { usdcBalance: { increment: amountUsdc } },
      }),
      prisma.processedTransaction.create({
        data: { signature, source, amountUsdc, senderWallet, receiverWallet, topupId: pendingTopup.id },
      }),
    ])
    return { topupId: pendingTopup.id, matched: true }
  }

  await prisma.processedTransaction.create({
    data: { signature, source, amountUsdc, senderWallet, receiverWallet, topupId: null },
  })
  return { topupId: null, matched: false }
}

/** Mark PENDING usdc_solana topups past their expiresAt as EXPIRED. */
export async function expireStaleTopups(): Promise<number> {
  const result = await prisma.topup.updateMany({
    where: { status: 'PENDING', method: 'usdc_solana', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
  return result.count
}
