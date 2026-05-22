import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/app/generated/prisma/client'
import { getSession } from '@/lib/auth'
import { getDepositWallet, TOPUP_EXPIRY_HOURS } from '@/lib/usdc-topup'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const method: string = body.method ?? 'usdc_solana'

  // Mock top-up: dev only
  if (method === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Mock top-up not available in production' }, { status: 403 })
    }
    const parsed = parseFloat(body.amount)
    if (!parsed || parsed <= 0 || parsed > 10000) {
      return NextResponse.json({ error: 'Amount must be 1–10000' }, { status: 400 })
    }
    await prisma.$transaction([
      prisma.topup.create({
        data: { userId: session.userId, amount: parsed, method: 'mock', status: 'CONFIRMED' },
      }),
      prisma.advertiserWallet.upsert({
        where: { userId: session.userId },
        create: { userId: session.userId, usdcBalance: parsed },
        update: { usdcBalance: { increment: parsed } },
      }),
    ])
    const wallet = await prisma.advertiserWallet.findUnique({
      where: { userId: session.userId },
      select: { usdcBalance: true },
    })
    return NextResponse.json({ ok: true, newBalance: wallet?.usdcBalance })
  }

  // Real USDC top-up: requires advertiser wallet address on account
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { walletAddress: true },
  })
  if (!user?.walletAddress) {
    return NextResponse.json(
      { error: 'Set your Solana wallet address before topping up with USDC' },
      { status: 400 }
    )
  }

  const depositWallet = getDepositWallet()
  if (!depositWallet) {
    return NextResponse.json({ error: 'Deposit wallet not configured' }, { status: 503 })
  }

  // Cancel any existing pending topup for this user (one pending at a time)
  await prisma.topup.updateMany({
    where: { userId: session.userId, status: 'PENDING', method: 'usdc_solana' },
    data: { status: 'REJECTED' },
  })

  const expiresAt = new Date(Date.now() + TOPUP_EXPIRY_HOURS * 60 * 60 * 1000)
  const topup = await prisma.topup.create({
    data: {
      userId: session.userId,
      amount: 0,
      method: 'usdc_solana',
      status: 'PENDING',
      advertiserWallet: user.walletAddress,
      depositWallet,
      expiresAt,
    },
  })

  return NextResponse.json({
    ok: true,
    topupId: topup.id,
    depositWallet,
    advertiserWallet: user.walletAddress,
    expiresAt: topup.expiresAt,
  })
}

// Store the on-chain tx signature as a hint on the pending topup.
// Does NOT confirm the topup — Helius webhook/reconcile is still source of truth.
export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { topupId, txSignature } = await req.json()
  if (!topupId || !txSignature) {
    return NextResponse.json({ error: 'topupId and txSignature required' }, { status: 400 })
  }

  // Fetch without status filter so we can handle already-confirmed topups gracefully
  const topup = await prisma.topup.findFirst({
    where: { id: topupId, userId: session.userId },
    select: { status: true, txSignature: true },
  })
  if (!topup) return NextResponse.json({ error: 'Topup not found' }, { status: 404 })

  // Already processed by Helius — nothing to update, signal ok so frontend can move on
  if (topup.status !== 'PENDING') return NextResponse.json({ ok: true })

  // Idempotent: exact same signature already stored on this topup
  if (topup.txSignature === txSignature) return NextResponse.json({ ok: true })

  try {
    await prisma.topup.update({ where: { id: topupId }, data: { txSignature } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Unique constraint: a different topup already holds this signature
      return NextResponse.json(
        { error: 'This transaction signature is already associated with another top-up' },
        { status: 409 }
      )
    }
    console.error('[PATCH /api/topup] unexpected error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [wallet, topups] = await Promise.all([
    prisma.advertiserWallet.findUnique({
      where: { userId: session.userId },
      select: { usdcBalance: true },
    }),
    prisma.topup.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { walletAddress: true },
  })

  return NextResponse.json({
    balance: wallet?.usdcBalance ?? 0,
    topups,
    walletAddress: user?.walletAddress ?? null,
  })
}
