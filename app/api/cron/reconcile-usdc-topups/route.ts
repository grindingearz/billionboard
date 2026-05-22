import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { processUsdcTransfer, expireStaleTopups, USDC_MINT, getDepositWallet } from '@/lib/usdc-topup'

function authorized(req: Request): boolean {
  const secret = env.cronSecret
  return !secret || req.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const heliusApiKey = env.heliusApiKey
  const depositWallet = getDepositWallet()

  if (!heliusApiKey || !depositWallet) {
    return NextResponse.json({ error: 'Helius not configured' }, { status: 503 })
  }

  const expired = await expireStaleTopups()

  const pendingTopups = await prisma.topup.findMany({
    where: { status: 'PENDING', method: 'usdc_solana', advertiserWallet: { not: null } },
    orderBy: { createdAt: 'asc' },
  })

  let matched = 0
  let checked = 0

  for (const topup of pendingTopups) {
    if (!topup.advertiserWallet) continue
    checked++

    try {
      const url = `https://api.helius.xyz/v0/addresses/${topup.advertiserWallet}/transactions?api-key=${heliusApiKey}&type=TRANSFER&limit=20`
      const resp = await fetch(url)
      if (!resp.ok) continue

      const txs = (await resp.json()) as Array<{
        signature: string
        tokenTransfers?: Array<{ mint: string; toUserAccount: string; fromUserAccount: string; tokenAmount: number }>
      }>
      if (!Array.isArray(txs)) continue

      for (const tx of txs) {
        const transfers = (tx.tokenTransfers ?? []).filter(
          (t) => t.mint === USDC_MINT && t.toUserAccount === depositWallet
        )
        for (const t of transfers) {
          const result = await processUsdcTransfer(
            tx.signature,
            t.fromUserAccount,
            t.toUserAccount,
            t.tokenAmount,
            'reconcile',
            JSON.stringify(tx)
          )
          if (result.matched) matched++
        }
      }
    } catch {
      // Continue on per-topup errors
    }
  }

  return NextResponse.json({ ok: true, expired, checked, matched })
}
