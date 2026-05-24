/**
 * Settlement engine — moves earned revenue from source wallets to REVENUE_WALLET,
 * then splits to TREASURY_WALLET and DISTRIBUTION_WALLET.
 *
 * Server-side only. Never import this in client components or NEXT_PUBLIC_ paths.
 *
 * Money flows:
 *   AD_RENT_REVENUE:    TOPUP_WALLET → REVENUE_WALLET → TREASURY + DISTRIBUTION
 *   TRADING_FEE_REVENUE: FEE_CREATOR_WALLET → REVENUE_WALLET → TREASURY + DISTRIBUTION
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
  getOrCreateAssociatedTokenAccount,
  transferChecked,
} from '@solana/spl-token'
import { prisma } from './prisma'
import { env } from './env'
import { getSetting } from './settings'
import { parseKeypair } from './wallet-key-check'
import { Prisma } from '@/app/generated/prisma/client'
import { captureAppError } from './sentry'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDC_DECIMALS = 6

// Backoff schedule: delay after the Nth failure (0-indexed by current retryCount)
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] // 1min, 5min, 15min; give up after index ≥ 3

/** Classify whether an error message indicates a transient (retryable) failure. */
function isRetryable(msg: string): boolean {
  const lower = msg.toLowerCase()
  // Non-retryable: key / config errors
  if (lower.includes('failed to parse private key')) return false
  if (lower.includes('key mismatch')) return false
  if (lower.includes('missing wallet config')) return false
  if (lower.includes('private keys not configured')) return false
  // Non-retryable: balance / amount errors
  if (lower.includes('balance insufficient')) return false
  if (lower.includes('insufficient') && lower.includes('usdc')) return false
  if (lower.includes('insufficient') && lower.includes('sol')) return false
  // Non-retryable: address / validity errors
  if (lower.includes('invalidpublickey') || (lower.includes('invalid') && lower.includes('public key'))) return false
  if (lower.includes('event type') && lower.includes('not settleable')) return false
  // Transient: RPC errors, timeouts, network failures, blockhash expired, etc.
  return true
}

/** Compute when to next retry based on current retryCount (before this failure's increment). */
function computeNextRetry(currentRetryCount: number): Date | null {
  const delayMs = RETRY_DELAYS_MS[currentRetryCount]
  return delayMs !== undefined ? new Date(Date.now() + delayMs) : null
}

export type SettlementResult = {
  ok: boolean
  settlementId: string
  status: string
  error?: string
  moveToRevenueTx?: string | null
  treasuryTx?: string | null
  distributionTx?: string | null
}

/**
 * Settle a single revenue event on-chain.
 *
 * Idempotent — safe to call multiple times; only missing legs are sent.
 * Returns UNSETTLED (with error) if wallet config is incomplete.
 * Returns FAILED with critical error on key mismatch (never sends funds).
 */
export async function settleRevenueEvent(revenueEventId: string): Promise<SettlementResult> {
  const event = await prisma.revenueEvent.findUnique({
    where: { id: revenueEventId },
  })
  if (!event) {
    return { ok: false, settlementId: '', status: 'ERROR', error: 'Revenue event not found' }
  }

  if (event.type !== 'AD_RENT_REVENUE' && event.type !== 'TRADING_FEE_REVENUE') {
    return {
      ok: false,
      settlementId: '',
      status: 'SKIPPED',
      error: `Event type ${event.type} is not settleable`,
    }
  }

  // Resolve wallets from env
  const topupWallet = env.topupWallet
  const feeCreatorWallet = env.feeCreatorWallet
  const revenueWallet = env.revenueWallet
  const treasuryWallet = env.treasuryWallet
  const distributionWallet = env.distributionWallet

  const sourceWallet =
    event.type === 'AD_RENT_REVENUE' ? topupWallet : feeCreatorWallet

  // Check required wallet addresses
  if (!sourceWallet || !revenueWallet || !treasuryWallet || !distributionWallet) {
    const missing: string[] = []
    if (!sourceWallet) missing.push(event.type === 'AD_RENT_REVENUE' ? 'TOPUP_WALLET' : 'FEE_CREATOR_WALLET')
    if (!revenueWallet) missing.push('REVENUE_WALLET')
    if (!treasuryWallet) missing.push('TREASURY_WALLET')
    if (!distributionWallet) missing.push('DISTRIBUTION_WALLET')

    const existing = await prisma.revenueSettlement.findUnique({ where: { revenueEventId } })
    if (existing?.settlementStatus === 'SETTLED') {
      return { ok: true, settlementId: existing.id, status: 'SETTLED' }
    }

    const errorMsg = `Missing wallet config: ${missing.join(', ')}`
    if (existing) {
      await prisma.revenueSettlement.update({
        where: { id: existing.id },
        data: { settlementError: errorMsg, retryCount: { increment: 1 } },
      })
      return { ok: false, settlementId: existing.id, status: existing.settlementStatus, error: errorMsg }
    }
    const created = await createSettlementRecord(
      revenueEventId, sourceWallet ?? '', revenueWallet ?? '',
      treasuryWallet ?? '', distributionWallet ?? '',
      event.amount, 0, errorMsg
    )
    return { ok: false, settlementId: created.id, status: 'UNSETTLED', error: errorMsg }
  }

  // Load or create settlement record
  let settlement = await prisma.revenueSettlement.findUnique({ where: { revenueEventId } })

  if (settlement?.settlementStatus === 'SETTLED') {
    return {
      ok: true,
      settlementId: settlement.id,
      status: 'SETTLED',
      moveToRevenueTx: settlement.moveToRevenueTxSignature,
      treasuryTx: settlement.treasuryTxSignature,
      distributionTx: settlement.distributionTxSignature,
    }
  }

  // Calculate split amounts using integer micro-USDC to avoid float errors.
  // Floor-round both legs so treasury + distribution never exceeds amount; dust stays in revenue wallet.
  const feePercentStr = await getSetting('management_fee_percent')
  const feePercent = Math.max(0, Math.min(100, parseFloat(feePercentStr) || 10))
  const amountUsdc = Number(event.amount)
  const amountMicroUsdc = BigInt(Math.floor(amountUsdc * 1_000_000))
  const treasuryMicroUsdc = BigInt(Math.floor((amountUsdc * feePercent) / 100 * 1_000_000))
  const distributionMicroUsdc = amountMicroUsdc - treasuryMicroUsdc
  const treasuryAmount = Number(treasuryMicroUsdc) / 1_000_000
  const distributionAmount = Number(distributionMicroUsdc) / 1_000_000

  if (!settlement) {
    settlement = await createSettlementRecord(
      revenueEventId, sourceWallet, revenueWallet,
      treasuryWallet, distributionWallet,
      event.amount, feePercent, null,
      new Prisma.Decimal(treasuryAmount),
      new Prisma.Decimal(distributionAmount)
    )
  }

  // Check private keys
  const sourcePrivateKey =
    event.type === 'AD_RENT_REVENUE'
      ? env.topupWalletPrivateKey
      : env.feeCreatorWalletPrivateKey
  const revenuePrivateKey = env.revenueWalletPrivateKey

  if (!sourcePrivateKey || !revenuePrivateKey) {
    const missing: string[] = []
    if (!sourcePrivateKey) missing.push(event.type === 'AD_RENT_REVENUE' ? 'TOPUP_WALLET_PRIVATE_KEY' : 'FEE_CREATOR_WALLET_PRIVATE_KEY')
    if (!revenuePrivateKey) missing.push('REVENUE_WALLET_PRIVATE_KEY')
    const errorMsg = `Private keys not configured (${missing.join(', ')}) — settlement pending manual`
    await prisma.revenueSettlement.update({
      where: { id: settlement.id },
      data: { settlementError: errorMsg, retryCount: { increment: 1 }, retryable: false, nextRetryAt: null },
    })
    return { ok: false, settlementId: settlement.id, status: settlement.settlementStatus, error: errorMsg }
  }

  // Parse and verify keypairs — failures here are always non-retryable config errors
  let sourceKeypair: Keypair
  let revenueKeypair: Keypair
  try {
    sourceKeypair = parseKeypair(sourcePrivateKey)
    revenueKeypair = parseKeypair(revenuePrivateKey)
  } catch (err) {
    const errorMsg = `Failed to parse private key: ${err instanceof Error ? err.message : String(err)}`
    await prisma.revenueSettlement.update({
      where: { id: settlement.id },
      data: { settlementStatus: 'FAILED', settlementError: errorMsg, retryable: false, nextRetryAt: null },
    })
    captureAppError(err, { route: 'settlement', settlementId: settlement.id, revenueEventId, status: 'FAILED' })
    return { ok: false, settlementId: settlement.id, status: 'FAILED', error: errorMsg }
  }

  // Critical: verify signer public keys match expected wallets — never retryable
  if (sourceKeypair.publicKey.toBase58() !== sourceWallet) {
    const errorMsg = `CRITICAL: source wallet key mismatch. Settlement disabled.`
    await prisma.revenueSettlement.update({
      where: { id: settlement.id },
      data: { settlementStatus: 'FAILED', settlementError: `CRITICAL: source wallet key mismatch. Key is ${sourceKeypair.publicKey.toBase58()}, expected ${sourceWallet}. Settlement disabled.`, retryable: false, nextRetryAt: null },
    })
    captureAppError(new Error(errorMsg), { route: 'settlement', settlementId: settlement.id, revenueEventId, status: 'FAILED' })
    return { ok: false, settlementId: settlement.id, status: 'FAILED', error: errorMsg }
  }

  if (revenueKeypair.publicKey.toBase58() !== revenueWallet) {
    const errorMsg = `CRITICAL: revenue wallet key mismatch. Settlement disabled.`
    await prisma.revenueSettlement.update({
      where: { id: settlement.id },
      data: { settlementStatus: 'FAILED', settlementError: `CRITICAL: revenue wallet key mismatch. Key is ${revenueKeypair.publicKey.toBase58()}, expected ${revenueWallet}. Settlement disabled.`, retryable: false, nextRetryAt: null },
    })
    captureAppError(new Error(errorMsg), { route: 'settlement', settlementId: settlement.id, revenueEventId, status: 'FAILED' })
    return { ok: false, settlementId: settlement.id, status: 'FAILED', error: errorMsg }
  }

  // Connect to Solana
  const rpcUrl = env.heliusRpcUrl ?? 'https://api.mainnet-beta.solana.com'
  const connection = new Connection(rpcUrl, 'confirmed')

  const usdcMint = new PublicKey(USDC_MINT)
  const sourcePubkey = new PublicKey(sourceWallet)
  const revenuePubkey = new PublicKey(revenueWallet)
  const treasuryPubkey = new PublicKey(treasuryWallet)
  const distributionPubkey = new PublicKey(distributionWallet)

  // Step 1: source → revenue (skip if already done)
  let moveToRevenueTx = settlement.moveToRevenueTxSignature

  if (!moveToRevenueTx) {
    await prisma.revenueSettlement.update({
      where: { id: settlement.id },
      data: { settlementStatus: 'MOVING_TO_REVENUE', settlementError: null },
    })

    try {
      const sourceAta = await getOrCreateAssociatedTokenAccount(
        connection, sourceKeypair, usdcMint, sourcePubkey
      )
      const revenueAta = await getOrCreateAssociatedTokenAccount(
        connection, sourceKeypair, usdcMint, revenuePubkey
      )

      // Safety: verify source has enough balance
      if (sourceAta.amount < amountMicroUsdc) {
        throw new Error(
          `Source ATA balance insufficient: ${sourceAta.amount} micro-USDC available, need ${amountMicroUsdc}`
        )
      }

      moveToRevenueTx = await transferChecked(
        connection,
        sourceKeypair,       // fee payer
        sourceAta.address,   // from
        usdcMint,
        revenueAta.address,  // to
        sourceKeypair,       // owner of source ATA
        amountMicroUsdc,
        USDC_DECIMALS
      )

      await prisma.revenueSettlement.update({
        where: { id: settlement.id },
        data: { moveToRevenueTxSignature: moveToRevenueTx, settlementStatus: 'MOVED_TO_REVENUE' },
      })
    } catch (err) {
      const errorMsg = `Move to revenue failed: ${err instanceof Error ? err.message : String(err)}`
      const retryable = isRetryable(errorMsg)
      const nextRetryAt = retryable ? computeNextRetry(settlement.retryCount) : null
      await prisma.revenueSettlement.update({
        where: { id: settlement.id },
        data: {
          settlementStatus: 'FAILED', settlementError: errorMsg,
          retryCount: { increment: 1 }, retryable: retryable && nextRetryAt !== null,
          lastRetryAt: new Date(), nextRetryAt,
        },
      })
      captureAppError(err, { route: 'settlement', settlementId: settlement.id, revenueEventId, status: 'FAILED', retryCount: settlement.retryCount })
      return { ok: false, settlementId: settlement.id, status: 'FAILED', error: errorMsg }
    }
  }

  // Step 2: revenue → treasury + distribution
  await prisma.revenueSettlement.update({
    where: { id: settlement.id },
    data: { settlementStatus: 'SPLITTING' },
  })

  let treasuryTx = settlement.treasuryTxSignature
  let distributionTx = settlement.distributionTxSignature

  // Treasury leg (skip if already done)
  if (!treasuryTx && treasuryMicroUsdc > 0n) {
    try {
      const revenueAta = await getOrCreateAssociatedTokenAccount(
        connection, revenueKeypair, usdcMint, revenuePubkey
      )
      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        connection, revenueKeypair, usdcMint, treasuryPubkey
      )

      treasuryTx = await transferChecked(
        connection,
        revenueKeypair,
        revenueAta.address,
        usdcMint,
        treasuryAta.address,
        revenueKeypair,
        treasuryMicroUsdc,
        USDC_DECIMALS
      )

      await prisma.revenueSettlement.update({
        where: { id: settlement.id },
        data: { treasuryTxSignature: treasuryTx },
      })
    } catch (err) {
      const errorMsg = `Treasury transfer failed: ${err instanceof Error ? err.message : String(err)}`
      const retryable = isRetryable(errorMsg)
      const nextRetryAt = retryable ? computeNextRetry(settlement.retryCount) : null
      await prisma.revenueSettlement.update({
        where: { id: settlement.id },
        data: {
          settlementStatus: 'PARTIAL', settlementError: errorMsg,
          retryCount: { increment: 1 }, retryable: retryable && nextRetryAt !== null,
          lastRetryAt: new Date(), nextRetryAt,
        },
      })
      captureAppError(err, { route: 'settlement', settlementId: settlement.id, revenueEventId, status: 'PARTIAL', retryCount: settlement.retryCount })
      return { ok: false, settlementId: settlement.id, status: 'PARTIAL', error: errorMsg, moveToRevenueTx }
    }
  }

  // Distribution leg (skip if already done)
  if (!distributionTx && distributionMicroUsdc > 0n) {
    try {
      const revenueAta = await getOrCreateAssociatedTokenAccount(
        connection, revenueKeypair, usdcMint, revenuePubkey
      )
      const distributionAta = await getOrCreateAssociatedTokenAccount(
        connection, revenueKeypair, usdcMint, distributionPubkey
      )

      distributionTx = await transferChecked(
        connection,
        revenueKeypair,
        revenueAta.address,
        usdcMint,
        distributionAta.address,
        revenueKeypair,
        distributionMicroUsdc,
        USDC_DECIMALS
      )
    } catch (err) {
      const errorMsg = `Distribution transfer failed: ${err instanceof Error ? err.message : String(err)}`
      const retryable = isRetryable(errorMsg)
      const nextRetryAt = retryable ? computeNextRetry(settlement.retryCount) : null
      await prisma.revenueSettlement.update({
        where: { id: settlement.id },
        data: {
          settlementStatus: 'PARTIAL', settlementError: errorMsg,
          retryCount: { increment: 1 }, retryable: retryable && nextRetryAt !== null,
          lastRetryAt: new Date(), nextRetryAt,
        },
      })
      captureAppError(err, { route: 'settlement', settlementId: settlement.id, revenueEventId, status: 'PARTIAL', retryCount: settlement.retryCount })
      return {
        ok: false, settlementId: settlement.id, status: 'PARTIAL', error: errorMsg,
        moveToRevenueTx, treasuryTx,
      }
    }
  }

  // All legs complete
  await prisma.revenueSettlement.update({
    where: { id: settlement.id },
    data: {
      distributionTxSignature: distributionTx ?? settlement.distributionTxSignature,
      settlementStatus: 'SETTLED',
      settlementError: null,
      settledAt: new Date(),
      retryable: false,
      nextRetryAt: null,
    },
  })

  return {
    ok: true,
    settlementId: settlement.id,
    status: 'SETTLED',
    moveToRevenueTx,
    treasuryTx,
    distributionTx,
  }
}

/**
 * Dry-run: returns what would be sent without executing any transfers.
 */
export async function dryRunSettlement(revenueEventId: string): Promise<{
  ok: boolean
  error?: string
  plan?: {
    sourceWallet: string
    revenueWallet: string
    treasuryWallet: string
    distributionWallet: string
    amount: number
    treasuryAmount: number
    distributionAmount: number
    feePercent: number
    signerStatus: { source: 'ok' | 'missing' | 'mismatch'; revenue: 'ok' | 'missing' | 'mismatch' }
  }
}> {
  const event = await prisma.revenueEvent.findUnique({ where: { id: revenueEventId } })
  if (!event) return { ok: false, error: 'Revenue event not found' }
  if (event.type !== 'AD_RENT_REVENUE' && event.type !== 'TRADING_FEE_REVENUE') {
    return { ok: false, error: `Event type ${event.type} is not settleable` }
  }

  const topupWallet = env.topupWallet
  const feeCreatorWallet = env.feeCreatorWallet
  const revenueWallet = env.revenueWallet
  const treasuryWallet = env.treasuryWallet
  const distributionWallet = env.distributionWallet
  const sourceWallet = event.type === 'AD_RENT_REVENUE' ? topupWallet : feeCreatorWallet

  if (!sourceWallet || !revenueWallet || !treasuryWallet || !distributionWallet) {
    return { ok: false, error: 'Missing wallet config' }
  }

  const feePercentStr = await getSetting('management_fee_percent')
  const feePercent = Math.max(0, Math.min(100, parseFloat(feePercentStr) || 10))
  const amountUsdc = Number(event.amount)
  const treasuryAmount = (amountUsdc * feePercent) / 100
  const distributionAmount = amountUsdc - treasuryAmount

  const sourcePrivateKey =
    event.type === 'AD_RENT_REVENUE' ? env.topupWalletPrivateKey : env.feeCreatorWalletPrivateKey
  const revenuePrivateKey = env.revenueWalletPrivateKey

  let sourceSignerStatus: 'ok' | 'missing' | 'mismatch' = 'missing'
  let revenueSignerStatus: 'ok' | 'missing' | 'mismatch' = 'missing'

  if (sourcePrivateKey) {
    try {
      const kp = parseKeypair(sourcePrivateKey)
      sourceSignerStatus = kp.publicKey.toBase58() === sourceWallet ? 'ok' : 'mismatch'
    } catch { sourceSignerStatus = 'mismatch' }
  }
  if (revenuePrivateKey) {
    try {
      const kp = parseKeypair(revenuePrivateKey)
      revenueSignerStatus = kp.publicKey.toBase58() === revenueWallet ? 'ok' : 'mismatch'
    } catch { revenueSignerStatus = 'mismatch' }
  }

  return {
    ok: true,
    plan: {
      sourceWallet,
      revenueWallet,
      treasuryWallet,
      distributionWallet,
      amount: amountUsdc,
      treasuryAmount,
      distributionAmount,
      feePercent,
      signerStatus: { source: sourceSignerStatus, revenue: revenueSignerStatus },
    },
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function createSettlementRecord(
  revenueEventId: string,
  sourceWallet: string,
  revenueWallet: string,
  treasuryWallet: string,
  distributionWallet: string,
  amount: Prisma.Decimal | number,
  feePercent: number,
  errorMsg: string | null,
  treasuryAmount?: Prisma.Decimal,
  distributionAmount?: Prisma.Decimal
) {
  const amountNum = Number(amount)
  const treasury = treasuryAmount ?? new Prisma.Decimal((amountNum * feePercent) / 100)
  const distribution = distributionAmount ?? new Prisma.Decimal(amountNum - Number(treasury))

  return prisma.revenueSettlement.create({
    data: {
      revenueEventId,
      sourceWallet,
      revenueWallet,
      treasuryWallet,
      distributionWallet,
      amount,
      treasuryAmount: treasury,
      distributionAmount: distribution,
      settlementStatus: 'UNSETTLED',
      settlementError: errorMsg,
    },
  })
}
