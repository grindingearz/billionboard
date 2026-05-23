import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, walletMismatch } from '@/lib/auth'
import { verifyAndProcessSignature } from '@/lib/usdc-topup'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (walletMismatch(session, req)) return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 })

  const body = await req.json()
  const { topupId } = body as { topupId?: string }
  if (!topupId) return NextResponse.json({ error: 'topupId required' }, { status: 400 })

  const topup = await prisma.topup.findFirst({
    where: { id: topupId, userId: session.userId },
    select: { id: true, status: true, txSignature: true },
  })
  if (!topup) return NextResponse.json({ error: 'Topup not found' }, { status: 404 })

  if (topup.status !== 'PENDING') {
    const wallet = await prisma.advertiserWallet.findUnique({
      where: { userId: session.userId },
      select: { usdcBalance: true },
    })
    return NextResponse.json({ ok: true, status: topup.status, balance: Number(wallet?.usdcBalance ?? 0) })
  }

  if (!topup.txSignature) {
    return NextResponse.json({ ok: true, status: 'PENDING', message: 'No transaction signature stored yet' })
  }

  const result = await verifyAndProcessSignature(topup.txSignature)

  const wallet = await prisma.advertiserWallet.findUnique({
    where: { userId: session.userId },
    select: { usdcBalance: true },
  })
  const balance = Number(wallet?.usdcBalance ?? 0)

  if (!result.ok) {
    if ('found' in result) {
      return NextResponse.json({ ok: true, status: 'PENDING', message: result.message, balance })
    }
    return NextResponse.json({ ok: false, status: 'PENDING', error: result.error, balance }, { status: 502 })
  }

  const anyMatched = result.results.some((r) => r.matched)
  const anySkipped = result.results.some((r) => r.skipped && r.reason === 'duplicate')
  const finalStatus = anyMatched || anySkipped
    ? 'CONFIRMED'
    : result.results[0]?.reason ?? 'UNMATCHED'

  const updatedTopup = await prisma.topup.findUnique({
    where: { id: topupId },
    select: { status: true },
  })

  return NextResponse.json({
    ok: true,
    status: updatedTopup?.status ?? finalStatus,
    balance,
    results: result.results,
  })
}
