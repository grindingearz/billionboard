import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { getPayoutReadiness, executePayout } from '@/lib/payout'
import { captureAppError } from '@/lib/sentry'

async function isEpochDistributionFunded(epochId: string): Promise<boolean> {
  const settled = await prisma.revenueSettlement.findFirst({
    where: {
      revenueEvent: { epochId },
      settlementStatus: 'SETTLED',
      distributionTxSignature: { not: null },
    },
  })
  return !!settled
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const wallet = searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 })

  const [allClaims, excluded] = await Promise.all([
    prisma.claim.findMany({
      where: { walletAddress: wallet },
      include: { epoch: { select: { epochDate: true, status: true, id: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.excludedWallet.findUnique({ where: { walletAddress: wallet } }),
  ])

  const claimableClaims = allClaims.filter((c) => c.status === 'CLAIMABLE')
  const historyClaims = allClaims.filter((c) => c.status !== 'CLAIMABLE')

  // Fetch HolderSnapshots for claimable epochs to get tokenBalance and sharePercent
  const snapshots =
    claimableClaims.length > 0
      ? await prisma.holderSnapshot.findMany({
          where: { walletAddress: wallet, epochId: { in: claimableClaims.map((c) => c.epochId) } },
          include: { epoch: { select: { eligibleSupply: true } } },
        })
      : []
  const snapMap = new Map(snapshots.map((s) => [s.epochId, s]))

  const readiness = getPayoutReadiness()

  const claimableWithDetails = await Promise.all(
    claimableClaims.map(async (c) => {
      const snap = snapMap.get(c.epochId)
      const tokenBalance = snap ? Number(snap.tokenBalance) : null
      const eligibleSupply = snap ? Number(snap.epoch.eligibleSupply ?? 0) : 0
      const sharePercent =
        tokenBalance !== null && eligibleSupply > 0 ? (tokenBalance / eligibleSupply) * 100 : null
      return {
        ...c,
        tokenBalance,
        sharePercent,
        distributionFunded: await isEpochDistributionFunded(c.epochId),
      }
    })
  )

  // Backward compat: old-style snapshots in PUBLISHED epochs that don't have a Claim record yet
  const claimedEpochIds = new Set(allClaims.map((c) => c.epochId))
  const legacySnapshots = await prisma.holderSnapshot.findMany({
    where: {
      walletAddress: wallet,
      excluded: false,
      epochId: { notIn: Array.from(claimedEpochIds) },
      epoch: { status: { in: ['PUBLISHED', 'CLAIMING_OPEN'] } },
    },
    include: {
      epoch: { select: { epochDate: true, status: true, id: true, eligibleSupply: true } },
    },
  })

  const legacyClaimable = await Promise.all(
    legacySnapshots.map(async (s) => {
      const tokenBalance = Number(s.tokenBalance)
      const eligibleSupply = Number(s.epoch.eligibleSupply ?? 0)
      return {
        epochId: s.epochId,
        claimAmount: s.claimAmount,
        amount: s.claimAmount,
        status: 'CLAIMABLE' as const,
        epoch: { epochDate: s.epoch.epochDate, status: s.epoch.status, id: s.epoch.id },
        tokenBalance,
        sharePercent: eligibleSupply > 0 ? (tokenBalance / eligibleSupply) * 100 : null,
        distributionFunded: await isEpochDistributionFunded(s.epochId),
        isLegacy: true,
      }
    })
  )

  return NextResponse.json({
    wallet,
    excluded: !!(excluded && excluded.active !== false),
    claimable: [...claimableWithDetails, ...legacyClaimable],
    claims: historyClaims,
    payoutActive: readiness.ready,
    tokenBalance: null,
  })
}

export async function POST(req: Request) {
  // Security: never trust body.wallet — use authenticated session
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Wallet not authenticated' }, { status: 401 })
  }
  const wallet = session.walletAddress

  const { epochId } = await req.json()
  if (!epochId) return NextResponse.json({ error: 'epochId required' }, { status: 400 })

  const excluded = await prisma.excludedWallet.findUnique({ where: { walletAddress: wallet } })
  if (excluded && excluded.active !== false) {
    return NextResponse.json({ error: 'Wallet excluded' }, { status: 403 })
  }

  // Epoch must be open for claims
  const epoch = await prisma.distributionEpoch.findUnique({ where: { id: epochId } })
  if (!epoch) return NextResponse.json({ error: 'Epoch not found' }, { status: 404 })
  if (!['PUBLISHED', 'CLAIMING_OPEN'].includes(epoch.status)) {
    return NextResponse.json({ error: 'Epoch not open for claims' }, { status: 400 })
  }

  // Try pre-created CLAIMABLE Claim first (new flow)
  const existingClaim = await prisma.claim.findUnique({
    where: { epochId_walletAddress: { epochId, walletAddress: wallet } },
  })

  if (existingClaim) {
    if (existingClaim.status !== 'CLAIMABLE') {
      return NextResponse.json(
        { error: 'Already claimed or in progress', status: existingClaim.status },
        { status: 409 }
      )
    }

    // Atomic CLAIMABLE → PENDING (double-claim protection: only succeeds if still CLAIMABLE)
    const updated = await prisma.claim.updateMany({
      where: { id: existingClaim.id, status: 'CLAIMABLE' },
      data: { status: 'PENDING' },
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Claim already in progress' }, { status: 409 })
    }

    const readiness = getPayoutReadiness()
    if (!readiness.ready) {
      return NextResponse.json({
        ok: true,
        claim: { ...existingClaim, status: 'PENDING' },
        payoutPending: true,
        message: 'Claim registered. USDC will be sent once the distribution wallet is configured.',
      })
    }

    const funded = await isEpochDistributionFunded(epochId)
    if (!funded) {
      return NextResponse.json(
        { ok: false, fundingPending: true, message: 'Claim pool not yet funded for this epoch.' },
        { status: 202 }
      )
    }

    const result = await executePayout(existingClaim.id, wallet)
    if (!result.ok && result.error) {
      captureAppError(new Error(result.error), { route: '/api/claims', claimId: existingClaim.id, epochId, status: 'FAILED' })
    }
    const finalClaim = await prisma.claim.findUnique({ where: { id: existingClaim.id } })
    return NextResponse.json({
      ok: result.ok,
      claim: finalClaim,
      ...(result.error ? { error: result.error } : {}),
    })
  }

  // Backward compat: no pre-created Claim — look for a HolderSnapshot
  const snapshot = await prisma.holderSnapshot.findUnique({
    where: { epochId_walletAddress: { epochId, walletAddress: wallet } },
  })
  if (!snapshot || snapshot.excluded) {
    return NextResponse.json({ error: 'No eligible snapshot found' }, { status: 404 })
  }

  const funded = await isEpochDistributionFunded(epochId)
  if (!funded) {
    return NextResponse.json(
      { ok: false, fundingPending: true, message: 'Claim pool not yet funded for this epoch.' },
      { status: 202 }
    )
  }

  const readiness = getPayoutReadiness()
  const claim = await prisma.claim.create({
    data: {
      epochId,
      walletAddress: wallet,
      amount: snapshot.claimAmount,
      status: 'PENDING',
    },
  })

  if (!readiness.ready) {
    return NextResponse.json({
      ok: true,
      claim,
      payoutPending: true,
      message: 'Claim registered. USDC will be sent once the distribution wallet is configured.',
    })
  }

  const result = await executePayout(claim.id, wallet)
  if (!result.ok && result.error) {
    captureAppError(new Error(result.error), { route: '/api/claims', claimId: claim.id, epochId, status: 'FAILED' })
  }
  const finalClaim = await prisma.claim.findUnique({ where: { id: claim.id } })
  return NextResponse.json({
    ok: result.ok,
    claim: finalClaim,
    ...(result.error ? { error: result.error } : {}),
  })
}
