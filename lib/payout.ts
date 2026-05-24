/**
 * Payout engine — sends USDC from the distribution wallet to a holder's wallet.
 *
 * Server-side only. Never import in client components or NEXT_PUBLIC_ paths.
 * Never log or expose private key material.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { getOrCreateAssociatedTokenAccount, transferChecked } from '@solana/spl-token'
import { prisma } from './prisma'
import { env } from './env'
import { parseKeypair } from './wallet-key-check'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDC_DECIMALS = 6

export type PayoutReadiness = {
  mintConfigured: boolean
  walletConfigured: boolean
  signerConfigured: boolean
  signerMatches: boolean
  ready: boolean
  warnings: string[]
}

export function getPayoutReadiness(): PayoutReadiness {
  // Server-side BOARD_MINT takes precedence over the public var
  const boardMint = process.env.BOARD_MINT || process.env.NEXT_PUBLIC_BOARD_MINT || null
  const distWallet = env.distributionWallet
  const distKey = env.distributionWalletPrivateKey

  const mintConfigured = !!boardMint
  const walletConfigured = !!distWallet
  const signerConfigured = !!distKey

  let signerMatches = false
  const warnings: string[] = []

  if (!mintConfigured) warnings.push('BOARD_MINT not configured — claims disabled until token launch')
  if (!walletConfigured) warnings.push('DISTRIBUTION_WALLET not configured')

  if (signerConfigured && walletConfigured) {
    try {
      const kp = parseKeypair(distKey!)
      signerMatches = kp.publicKey.toBase58() === distWallet
      if (!signerMatches) {
        warnings.push(
          'DISTRIBUTION_WALLET_PRIVATE_KEY does not match DISTRIBUTION_WALLET — payouts disabled for safety'
        )
      }
    } catch (err) {
      warnings.push(
        `DISTRIBUTION_WALLET_PRIVATE_KEY parse error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  } else if (!signerConfigured) {
    warnings.push('DISTRIBUTION_WALLET_PRIVATE_KEY not configured — payouts will be manual')
  }

  const ready = mintConfigured && walletConfigured && signerConfigured && signerMatches

  return { mintConfigured, walletConfigured, signerConfigured, signerMatches, ready, warnings }
}

export type PayoutResult = {
  ok: boolean
  txSignature?: string
  error?: string
}

/**
 * Execute USDC payout for an already-PENDING claim.
 *
 * The claim must already be in PENDING status (set by the caller atomically).
 * On success: updates Claim to CLAIMED with txHash.
 * On failure: updates Claim to FAILED with error.
 * Amounts are floor-rounded in micro-USDC; dust stays in the distribution wallet.
 */
export async function executePayout(claimId: string, recipientWallet: string): Promise<PayoutResult> {
  const distWallet = env.distributionWallet
  const distKeyRaw = env.distributionWalletPrivateKey

  if (!distWallet || !distKeyRaw) {
    const msg = 'Distribution wallet not configured'
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'FAILED', error: msg } })
    return { ok: false, error: msg }
  }

  let distKeypair: Keypair
  try {
    distKeypair = parseKeypair(distKeyRaw)
  } catch (err) {
    const msg = `Failed to parse distribution key: ${err instanceof Error ? err.message : String(err)}`
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'FAILED', error: msg } })
    return { ok: false, error: msg }
  }

  // Critical safety check: key must match the configured wallet — never transfer if mismatch
  if (distKeypair.publicKey.toBase58() !== distWallet) {
    const msg = 'CRITICAL: distribution wallet key mismatch — payouts disabled for safety'
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'FAILED', error: msg } })
    return { ok: false, error: msg }
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } })
  if (!claim) return { ok: false, error: 'Claim not found' }

  const amountUsdc = Number(claim.amount)
  // Floor to avoid sending more than entitled; dust stays in distribution wallet
  const amountMicro = BigInt(Math.floor(amountUsdc * 1_000_000))

  if (amountMicro <= 0n) {
    await prisma.claim.update({
      where: { id: claimId },
      data: { status: 'CLAIMED', claimedAt: new Date() },
    })
    return { ok: true }
  }

  const rpcUrl = env.heliusRpcUrl ?? 'https://api.mainnet-beta.solana.com'
  const connection = new Connection(rpcUrl, 'confirmed')
  const usdcMint = new PublicKey(USDC_MINT)
  const distPubkey = new PublicKey(distWallet)
  const recipientPubkey = new PublicKey(recipientWallet)

  try {
    const distAta = await getOrCreateAssociatedTokenAccount(
      connection, distKeypair, usdcMint, distPubkey
    )

    if (distAta.amount < amountMicro) {
      const msg = `Distribution wallet USDC balance insufficient: ${distAta.amount} micro-USDC available, need ${amountMicro}`
      await prisma.claim.update({ where: { id: claimId }, data: { status: 'FAILED', error: msg } })
      return { ok: false, error: msg }
    }

    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection, distKeypair, usdcMint, recipientPubkey
    )

    const txSignature = await transferChecked(
      connection,
      distKeypair,          // fee payer + owner
      distAta.address,      // from
      usdcMint,
      recipientAta.address, // to
      distKeypair,
      amountMicro,
      USDC_DECIMALS
    )

    await prisma.claim.update({
      where: { id: claimId },
      data: { status: 'CLAIMED', txHash: txSignature, claimedAt: new Date() },
    })

    return { ok: true, txSignature }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'FAILED', error: msg } })
    return { ok: false, error: msg }
  }
}
