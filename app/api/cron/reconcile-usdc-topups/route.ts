import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { processUsdcTransfer, expireStaleTopups, USDC_MINT, getDepositWallet } from '@/lib/usdc-topup'

function authorized(req: Request): boolean {
  const secret = env.cronSecret
  if (!secret && process.env.NODE_ENV === 'production') return false
  return !secret || req.headers.get('authorization') === `Bearer ${secret}`
}

type TxDetail = {
  signature: string
  sender: string
  receiver: string
  amount: number
  matched: boolean
  skipped: boolean
  reason?: string
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const heliusApiKey = env.heliusApiKey
  const depositWallet = getDepositWallet()
  // Prefer env override; fall back to hardcoded mainnet USDC
  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT?.trim() || USDC_MINT

  if (!heliusApiKey || !depositWallet) {
    return NextResponse.json({
      ok: false,
      error: 'HELIUS_API_KEY or AD_REVENUE_WALLET not configured',
      scannedTransactions: 0,
      usdcTransfersFound: 0,
      matchedTopups: 0,
      unmatchedDeposits: 0,
      duplicatesIgnored: 0,
      expiredTopups: 0,
      errors: ['Missing HELIUS_API_KEY or AD_REVENUE_WALLET env var'],
      details: [],
    }, { status: 503 })
  }

  const errors: string[] = []
  const details: TxDetail[] = []
  const seenSignatures = new Set<string>()
  let scannedTransactions = 0
  let usdcTransfersFound = 0
  let matchedTopups = 0
  let unmatchedDeposits = 0
  let duplicatesIgnored = 0

  // 1. Expire stale topups
  const expiredTopups = await expireStaleTopups()

  // 2. Scan the deposit wallet directly — catches ALL incoming USDC regardless of sender
  try {
    const url = `https://api.helius.xyz/v0/addresses/${depositWallet}/transactions?api-key=${heliusApiKey}&type=TRANSFER&limit=50`
    const resp = await fetch(url)
    if (!resp.ok) {
      errors.push(`Deposit wallet scan failed: HTTP ${resp.status}`)
    } else {
      const txs = (await resp.json()) as Array<{
        signature: string
        tokenTransfers?: Array<{ mint: string; toUserAccount: string; fromUserAccount: string; tokenAmount: number }>
      }>
      if (!Array.isArray(txs)) {
        errors.push('Deposit wallet scan: unexpected response format')
      } else {
        scannedTransactions += txs.length
        for (const tx of txs) {
          const transfers = (tx.tokenTransfers ?? []).filter(
            (t) => t.mint === usdcMint && t.toUserAccount === depositWallet
          )
          for (const t of transfers) {
            usdcTransfersFound++
            seenSignatures.add(tx.signature)
            try {
              const result = await processUsdcTransfer(
                tx.signature, t.fromUserAccount, t.toUserAccount, t.tokenAmount, 'reconcile', JSON.stringify(tx)
              )
              details.push({ signature: tx.signature, sender: t.fromUserAccount, receiver: t.toUserAccount, amount: t.tokenAmount, matched: result.matched, skipped: result.skipped, reason: result.reason })
              if (result.skipped) duplicatesIgnored++
              else if (result.matched) matchedTopups++
              else unmatchedDeposits++
            } catch (e) {
              errors.push(`tx ${tx.signature.slice(0, 12)}…: ${e instanceof Error ? e.message : String(e)}`)
            }
          }
        }
      }
    }
  } catch (e) {
    errors.push(`Deposit wallet scan error: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 3. Also scan per-pending-topup (catches older transfers not in recent 50 deposit wallet txs)
  const pendingTopups = await prisma.topup.findMany({
    where: { status: 'PENDING', method: 'usdc_solana', advertiserWallet: { not: null } },
    orderBy: { createdAt: 'asc' },
  })

  for (const topup of pendingTopups) {
    if (!topup.advertiserWallet) continue
    try {
      const url = `https://api.helius.xyz/v0/addresses/${topup.advertiserWallet}/transactions?api-key=${heliusApiKey}&type=TRANSFER&limit=50`
      const resp = await fetch(url)
      if (!resp.ok) {
        errors.push(`Sender scan failed (topup ${topup.id.slice(0, 8)}): HTTP ${resp.status}`)
        continue
      }
      const txs = (await resp.json()) as Array<{
        signature: string
        tokenTransfers?: Array<{ mint: string; toUserAccount: string; fromUserAccount: string; tokenAmount: number }>
      }>
      if (!Array.isArray(txs)) continue

      for (const tx of txs) {
        if (seenSignatures.has(tx.signature)) continue
        const transfers = (tx.tokenTransfers ?? []).filter(
          (t) => t.mint === usdcMint && t.toUserAccount === depositWallet
        )
        for (const t of transfers) {
          usdcTransfersFound++
          scannedTransactions++
          seenSignatures.add(tx.signature)
          try {
            const result = await processUsdcTransfer(
              tx.signature, t.fromUserAccount, t.toUserAccount, t.tokenAmount, 'reconcile', JSON.stringify(tx)
            )
            details.push({ signature: tx.signature, sender: t.fromUserAccount, receiver: t.toUserAccount, amount: t.tokenAmount, matched: result.matched, skipped: result.skipped, reason: result.reason })
            if (result.skipped) duplicatesIgnored++
            else if (result.matched) matchedTopups++
            else unmatchedDeposits++
          } catch (e) {
            errors.push(`tx ${tx.signature.slice(0, 12)}…: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
    } catch (e) {
      errors.push(`Sender scan error (topup ${topup.id.slice(0, 8)}): ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({
    ok: true,
    scannedTransactions,
    usdcTransfersFound,
    matchedTopups,
    unmatchedDeposits,
    duplicatesIgnored,
    expiredTopups,
    errors,
    details,
  })
}
