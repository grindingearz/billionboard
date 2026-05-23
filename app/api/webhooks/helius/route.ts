import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createRevenueEvent } from '@/lib/revenue'
import { USDC_MINT, processUsdcTransfer, getDepositWallet } from '@/lib/usdc-topup'
import type { HeliusTransaction } from '@/lib/usdc-topup'

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const secret = env.cronSecret
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const depositWallet = getDepositWallet()
  const feeCreatorWallet = env.feeCreatorWallet

  if (!depositWallet && !feeCreatorWallet) {
    return NextResponse.json({ error: 'No wallets configured' }, { status: 503 })
  }

  const body = await req.text()
  let transactions: HeliusTransaction[]
  try {
    const parsed = JSON.parse(body) as unknown
    transactions = Array.isArray(parsed) ? (parsed as HeliusTransaction[]) : [parsed as HeliusTransaction]
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const results = []
  for (const tx of transactions) {
    if (!tx.signature) continue

    const transfers = (tx.tokenTransfers ?? []) as Array<{
      fromUserAccount: string
      toUserAccount: string
      mint: string
      tokenAmount: number
    }>

    for (const t of transfers) {
      if (t.mint !== USDC_MINT) continue

      // Route: AD_REVENUE_WALLET → topup credit flow
      if (depositWallet && t.toUserAccount === depositWallet) {
        const result = await processUsdcTransfer(
          tx.signature,
          t.fromUserAccount,
          t.toUserAccount,
          t.tokenAmount,
          'webhook',
          body
        )
        results.push({ signature: tx.signature, route: 'topup', ...result })
        continue
      }

      // Route: FEE_CREATOR_WALLET → record as TRADING_FEE_REVENUE
      if (feeCreatorWallet && t.toUserAccount === feeCreatorWallet) {
        try {
          await createRevenueEvent({
            type: 'TRADING_FEE_REVENUE',
            source: 'webhook',
            amount: t.tokenAmount,
            currency: 'USDC',
            wallet: feeCreatorWallet,
            txSignature: tx.signature,
            metadata: { fromWallet: t.fromUserAccount },
          })
          results.push({ signature: tx.signature, route: 'trading_fee', amount: t.tokenAmount })
        } catch (err) {
          // Duplicate txSignature index violation → skip (idempotent)
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('Unique constraint') && !msg.includes('unique constraint')) throw err
          results.push({ signature: tx.signature, route: 'trading_fee', skipped: true })
        }
      }
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}
