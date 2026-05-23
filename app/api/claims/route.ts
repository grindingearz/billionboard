import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'

function isPayoutActive(): boolean {
  return !!env.distributionWalletPrivateKey
}

/**
 * Check if the distribution pool for an epoch has been funded.
 * An epoch is considered funded if its settlement legs are SETTLED or the distribution tx exists.
 * This gates whether holders can claim.
 */
async function isEpochDistributionFunded(epochId: string): Promise<boolean> {
  // Check if any revenue event for this epoch has a completed distribution leg
  const settledForEpoch = await prisma.revenueSettlement.findFirst({
    where: {
      revenueEvent: { epochId },
      settlementStatus: 'SETTLED',
      distributionTxSignature: { not: null },
    },
  })
  return !!settledForEpoch
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const wallet = searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 })

  const [snapshots, claims, excluded] = await Promise.all([
    prisma.holderSnapshot.findMany({
      where: { walletAddress: wallet },
      include: { epoch: { select: { epochDate: true, status: true, id: true } } },
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

  // Only claimable when epoch is PUBLISHED and not yet claimed
  const claimable = snapshots.filter(
    (s) => s.epoch.status === 'PUBLISHED' && !claimedEpochIds.has(s.epochId)
  )

  // Annotate each claimable snapshot with distribution funding status
  const claimableWithFunding = await Promise.all(
    claimable.map(async (s) => ({
      ...s,
      distributionFunded: await isEpochDistributionFunded(s.epochId),
    }))
  )

  return NextResponse.json({
    wallet,
    excluded: !!excluded,
    claimable: claimableWithFunding,
    claims,
    payoutActive: isPayoutActive(),
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

  // Gate on distribution funding
  const funded = await isEpochDistributionFunded(epochId)
  if (!funded) {
    return NextResponse.json(
      {
        ok: false,
        fundingPending: true,
        message: 'Claim pool calculated. Funding pending — distribution wallet has not yet received funds for this epoch.',
      },
      { status: 202 }
    )
  }

  const existing = await prisma.claim.findUnique({
    where: { epochId_walletAddress: { epochId, walletAddress: wallet } },
  })
  if (existing) {
    return NextResponse.json({ error: 'Already claimed', status: existing.status }, { status: 409 })
  }

  if (!isPayoutActive()) {
    const claim = await prisma.claim.create({
      data: {
        epochId,
        walletAddress: wallet,
        amount: snapshot.claimAmount,
        status: 'PENDING',
      },
    })
    return NextResponse.json({
      ok: true,
      claim,
      payoutPending: true,
      message: 'Claim registered. Payouts activate once the distribution wallet private key is configured.',
    })
  }

  // Payout execution not yet implemented — register as PENDING
  const claim = await prisma.claim.create({
    data: {
      epochId,
      walletAddress: wallet,
      amount: snapshot.claimAmount,
      status: 'PENDING',
    },
  })

  return NextResponse.json({
    ok: true,
    claim,
    payoutPending: true,
    message: 'Claim registered. Payout processing pending — USDC will be sent once the transfer is executed.',
  })
}
