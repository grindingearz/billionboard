import { NextResponse } from 'next/server'
import { processUsdcTransfer, getDepositWallet } from '@/lib/usdc-topup'

// Dev-only: simulate a Helius USDC transfer webhook for testing
export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const { senderWallet, amountUsdc, signature } = await req.json()

  if (!senderWallet || !amountUsdc) {
    return NextResponse.json({ error: 'senderWallet and amountUsdc required' }, { status: 400 })
  }

  const depositWallet = getDepositWallet()
  if (!depositWallet) {
    return NextResponse.json({ error: 'Deposit wallet not configured' }, { status: 503 })
  }

  const fakeSig = signature ?? `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`

  const result = await processUsdcTransfer(
    fakeSig,
    senderWallet,
    depositWallet,
    parseFloat(amountUsdc),
    'webhook',
    JSON.stringify({ dev: true, senderWallet, amountUsdc })
  )

  return NextResponse.json({ ok: true, signature: fakeSig, ...result })
}
