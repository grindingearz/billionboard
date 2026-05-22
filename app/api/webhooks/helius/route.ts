import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { parseUsdcTransfers, processUsdcTransfer, getDepositWallet } from '@/lib/usdc-topup'
import type { HeliusTransaction } from '@/lib/usdc-topup'

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const secret = env.cronSecret
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const depositWallet = getDepositWallet()
  if (!depositWallet) {
    return NextResponse.json({ error: 'Deposit wallet not configured' }, { status: 503 })
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
    const transfers = parseUsdcTransfers(tx, depositWallet)
    for (const t of transfers) {
      const result = await processUsdcTransfer(
        tx.signature,
        t.fromUserAccount,
        t.toUserAccount,
        t.tokenAmount,
        'webhook',
        body
      )
      results.push({ signature: tx.signature, ...result })
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}
