import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const wallet = searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 })

  const [snapshots, claims, excluded] = await Promise.all([
    prisma.holderSnapshot.findMany({
      where: { walletAddress: wallet },
      include: { epoch: { select: { epochDate: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.claim.findMany({
      where: { walletAddress: wallet },
      include: { epoch: { select: { epochDate: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.excludedWallet.findUnique({ where: { walletAddress: wallet } }),
  ])

  const claimedEpochIds = new Set(claims.map((c) => c.epochId))
  const claimable = snapshots.filter(
    (s) => s.epoch.status === 'PUBLISHED' && !claimedEpochIds.has(s.epochId)
  )

  return NextResponse.json({
    wallet,
    excluded: !!excluded,
    claimable,
    claims,
    // TODO: real $BOARD token balance from Solana RPC
    tokenBalance: null,
  })
}

export async function POST(req: Request) {
  const { wallet, epochId } = await req.json()
  if (!wallet || !epochId) {
    return NextResponse.json({ error: 'wallet and epochId required' }, { status: 400 })
  }

  const excluded = await prisma.excludedWallet.findUnique({ where: { walletAddress: wallet } })
  if (excluded) return NextResponse.json({ error: 'Wallet excluded' }, { status: 403 })

  const snapshot = await prisma.holderSnapshot.findUnique({
    where: { epochId_walletAddress: { epochId, walletAddress: wallet } },
    include: { epoch: true },
  })
  if (!snapshot) return NextResponse.json({ error: 'No snapshot found' }, { status: 404 })
  if (snapshot.epoch.status !== 'PUBLISHED') {
    return NextResponse.json({ error: 'Epoch not published' }, { status: 400 })
  }

  const existing = await prisma.claim.findUnique({
    where: { epochId_walletAddress: { epochId, walletAddress: wallet } },
  })
  if (existing) return NextResponse.json({ error: 'Already claimed' }, { status: 409 })

  // TODO: execute real Solana USDC transfer here
  const claim = await prisma.claim.create({
    data: {
      epochId,
      walletAddress: wallet,
      amount: snapshot.claimAmount,
      status: 'CLAIMED',
      claimedAt: new Date(),
      txHash: `mock_tx_${Date.now()}`, // TODO: real Solana tx hash
    },
  })

  return NextResponse.json({ ok: true, claim })
}
