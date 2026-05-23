import { prisma } from './prisma'
import { env } from './env'

const HELIUS_ENHANCED_TX_URL = 'https://api.helius.xyz/v0/transactions'

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
  return env.topupWallet
}

export function parseUsdcTransfers(
  tx: HeliusTransaction,
  depositWallet: string
): HeliusTokenTransfer[] {
  return (tx.tokenTransfers ?? []).filter(
    (t) => t.mint === USDC_MINT && t.toUserAccount === depositWallet
  )
}

export type ProcessResult = {
  topupId: string | null
  matched: boolean
  skipped: boolean
  reason?: string
}

/**
 * Credit a USDC transfer to the matching pending topup, or record as unmatched.
 * Idempotent — duplicate signatures return skipped: true.
 * Returns reason string when unmatched: sender_mismatch | wrong_destination | no_pending_topup
 */
export async function processUsdcTransfer(
  signature: string,
  senderWallet: string,
  receiverWallet: string,
  amountUsdc: number,
  source: 'webhook' | 'reconcile',
  rawPayload?: string
): Promise<ProcessResult> {
  // Helius Enhanced Transactions returns tokenAmount as human-readable float (decimals already applied).
  // Guard against zero/negative amounts and implausibly large values that may indicate a raw-unit bug.
  if (!amountUsdc || amountUsdc <= 0) {
    return { topupId: null, matched: false, skipped: true, reason: 'zero_amount' }
  }
  if (amountUsdc > 500_000) {
    // Log but do not silently accept — amounts above $500k are extremely unlikely for billboard topups.
    console.warn(`[usdc-topup] Unusually large USDC amount: ${amountUsdc} for tx ${signature} — verify Helius tokenAmount is human-readable, not raw base units`)
  }

  const existing = await prisma.processedTransaction.findUnique({ where: { signature } })
  if (existing) return { topupId: existing.topupId, matched: !!existing.topupId, skipped: true, reason: 'duplicate' }

  // txSignature-first match — frontend stores sig immediately after sendTransaction;
  // this is the most reliable path when the user completes the one-click Pay USDC flow.
  const byTxSig = await prisma.topup.findFirst({
    where: {
      txSignature: signature,
      depositWallet: receiverWallet,
      status: 'PENDING',
      method: 'usdc_solana',
    },
    orderBy: { createdAt: 'asc' },
  })

  if (byTxSig) {
    await prisma.$transaction([
      prisma.topup.update({
        where: { id: byTxSig.id },
        data: { status: 'CONFIRMED', actualAmount: amountUsdc, rawPayload, confirmedAt: new Date() },
      }),
      prisma.advertiserWallet.upsert({
        where: { userId: byTxSig.userId },
        create: { userId: byTxSig.userId, usdcBalance: amountUsdc },
        update: { usdcBalance: { increment: amountUsdc } },
      }),
      prisma.processedTransaction.create({
        data: { signature, source, amountUsdc, senderWallet, receiverWallet, topupId: byTxSig.id },
      }),
    ])
    return { topupId: byTxSig.id, matched: true, skipped: false }
  }

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
    return { topupId: pendingTopup.id, matched: true, skipped: false }
  }

  // Figure out WHY it didn't match — helps admin diagnose
  const [bySender, byReceiver] = await Promise.all([
    prisma.topup.findFirst({
      where: { advertiserWallet: senderWallet, status: 'PENDING', method: 'usdc_solana' },
      select: { id: true },
    }),
    prisma.topup.findFirst({
      where: { depositWallet: receiverWallet, status: 'PENDING', method: 'usdc_solana' },
      select: { id: true },
    }),
  ])

  let reason = 'no_pending_topup'
  if (bySender && !byReceiver) reason = 'wrong_destination'
  else if (!bySender && byReceiver) reason = 'sender_mismatch'
  else if (bySender && byReceiver) reason = 'wallet_mismatch'

  await prisma.processedTransaction.create({
    data: { signature, source, amountUsdc, senderWallet, receiverWallet, topupId: null },
  })
  return { topupId: null, matched: false, skipped: false, reason }
}

export type VerifyResult =
  | { ok: true; found: true; results: Array<ProcessResult & { amount: number; sender: string }> }
  | { ok: false; found: false; message: string }
  | { ok: false; error: string }

/**
 * Fetch a transaction from Helius, find USDC transfers to the deposit wallet,
 * and process each via processUsdcTransfer. Used by the auto-verify flow and
 * the admin manual-recovery button.
 */
export async function verifyAndProcessSignature(signature: string): Promise<VerifyResult> {
  const heliusApiKey = env.heliusApiKey
  const depositWallet = getDepositWallet()

  if (!heliusApiKey || !depositWallet) {
    return { ok: false, error: 'HELIUS_API_KEY or AD_REVENUE_WALLET not configured' }
  }

  let resp: Response
  try {
    resp = await fetch(`${HELIUS_ENHANCED_TX_URL}?api-key=${heliusApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [signature.trim()] }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Helius network error: ${msg}` }
  }

  if (!resp.ok) {
    return { ok: false, error: `Helius HTTP ${resp.status}` }
  }

  let txs: unknown[]
  try {
    txs = await resp.json()
  } catch {
    return { ok: false, error: 'Helius returned non-JSON' }
  }

  if (!Array.isArray(txs) || txs.length === 0) {
    return { ok: false, found: false, message: 'Transaction not found on Helius — may not be confirmed yet' }
  }

  const tx = txs[0] as HeliusTransaction
  const transfers = parseUsdcTransfers(tx, depositWallet)

  if (transfers.length === 0) {
    return { ok: false, found: false, message: 'No USDC transfer to deposit wallet found in this transaction' }
  }

  const results: Array<ProcessResult & { amount: number; sender: string }> = []
  for (const t of transfers) {
    const result = await processUsdcTransfer(
      tx.signature, t.fromUserAccount, t.toUserAccount, t.tokenAmount, 'reconcile', JSON.stringify(tx)
    )
    results.push({ ...result, amount: t.tokenAmount, sender: t.fromUserAccount })
  }
  return { ok: true, found: true, results }
}

/** Mark PENDING usdc_solana topups past their expiresAt as EXPIRED. */
export async function expireStaleTopups(): Promise<number> {
  const result = await prisma.topup.updateMany({
    where: { status: 'PENDING', method: 'usdc_solana', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
  return result.count
}
