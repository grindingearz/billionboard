import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { getSetting, getTilePrice, isFreeRentalEnabled } from '@/lib/settings'
import { createRevenueEvent, getGrossRevenueForDate } from '@/lib/revenue'
import { fetchTokenHolders } from '@/lib/helius'
import { getOrCreateEpoch, todayUtc, msUntilUtcClose, closeEpochForDate, yesterdayUtc, utcDayStart } from '@/lib/epoch'
import { verifyAndProcessSignature } from '@/lib/usdc-topup'
import { settleRevenueEvent, dryRunSettlement } from '@/lib/settlement'

async function requireAdmin() {
  const session = await getSession()
  if (!session || session.role !== 'ADMIN') return null
  const adminWallet = env.adminWallet
  if (!adminWallet || session.adminWallet !== adminWallet) return null
  return session
}

export async function GET(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'pending'

  if (view === 'pending') {
    const BOARD_COLS = 400
    const allRentals = await prisma.adRental.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: {
        creative: true,
        user: { select: { email: true, walletAddress: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    type OrderAcc = {
      creativeId: string | null
      userId: string
      tileIds: number[]
      rentalIds: string[]
      status: string
      createdAt: Date
      dailyRateTotal: number
      creative: { imageUrl: string | null; destUrl: string; altText: string | null; displayMode: string } | null
      user: { email: string | null; walletAddress: string | null }
    }

    const orderMap = new Map<string, OrderAcc>()
    for (const rental of allRentals) {
      const key = rental.creativeId ?? `solo-${rental.id}`
      if (!orderMap.has(key)) {
        orderMap.set(key, {
          creativeId: rental.creativeId,
          userId: rental.userId,
          tileIds: [],
          rentalIds: [],
          status: rental.status,
          createdAt: rental.createdAt,
          dailyRateTotal: 0,
          creative: rental.creative
            ? { imageUrl: rental.creative.imageUrl, destUrl: rental.creative.destUrl,
                altText: rental.creative.altText, displayMode: rental.creative.displayMode }
            : null,
          user: { email: rental.user.email ?? null, walletAddress: rental.user.walletAddress ?? null },
        })
      }
      const o = orderMap.get(key)!
      o.tileIds.push(rental.tileId)
      o.rentalIds.push(rental.id)
      o.dailyRateTotal += Number(rental.dailyRate)
    }

    const orders = Array.from(orderMap.values()).map((o) => {
      let blockCols: number | undefined
      let blockRows: number | undefined
      if (o.creative?.displayMode === 'STRETCH' && o.tileIds.length > 1) {
        const cs = o.tileIds.map((id) => id % BOARD_COLS)
        const rs = o.tileIds.map((id) => Math.floor(id / BOARD_COLS))
        blockCols = Math.max(...cs) - Math.min(...cs) + 1
        blockRows = Math.max(...rs) - Math.min(...rs) + 1
      }
      return { ...o, tileCount: o.tileIds.length, blockCols, blockRows }
    })

    return NextResponse.json({ orders })
  }

  if (view === 'active') {
    const BOARD_COLS = 400
    const allRentals = await prisma.adRental.findMany({
      where: { status: 'ACTIVE' },
      include: {
        creative: true,
        user: { select: { email: true, walletAddress: true } },
      },
      orderBy: { startDate: 'desc' },
    })

    type ActiveOrderAcc = {
      creativeId: string | null
      userId: string
      tileIds: number[]
      rentalIds: string[]
      status: string
      createdAt: Date
      startDate: Date | null
      nextBillingAt: Date | null
      lastBilledAt: Date | null
      dailyRateTotal: number
      creative: { imageUrl: string | null; destUrl: string; altText: string | null; displayMode: string } | null
      user: { email: string | null; walletAddress: string | null }
    }

    const orderMap = new Map<string, ActiveOrderAcc>()
    for (const rental of allRentals) {
      const key = rental.creativeId ?? `solo-${rental.id}`
      if (!orderMap.has(key)) {
        orderMap.set(key, {
          creativeId: rental.creativeId,
          userId: rental.userId,
          tileIds: [],
          rentalIds: [],
          status: rental.status,
          createdAt: rental.createdAt,
          startDate: rental.startDate,
          nextBillingAt: rental.nextBillingAt,
          lastBilledAt: rental.lastBilledAt,
          dailyRateTotal: 0,
          creative: rental.creative
            ? { imageUrl: rental.creative.imageUrl, destUrl: rental.creative.destUrl,
                altText: rental.creative.altText, displayMode: rental.creative.displayMode }
            : null,
          user: { email: rental.user.email ?? null, walletAddress: rental.user.walletAddress ?? null },
        })
      }
      const o = orderMap.get(key)!
      o.tileIds.push(rental.tileId)
      o.rentalIds.push(rental.id)
      o.dailyRateTotal += Number(rental.dailyRate)
    }

    const orders = Array.from(orderMap.values()).map((o) => {
      let blockCols: number | undefined
      let blockRows: number | undefined
      if (o.creative?.displayMode === 'STRETCH' && o.tileIds.length > 1) {
        const cs = o.tileIds.map((id) => id % BOARD_COLS)
        const rs = o.tileIds.map((id) => Math.floor(id / BOARD_COLS))
        blockCols = Math.max(...cs) - Math.min(...cs) + 1
        blockRows = Math.max(...rs) - Math.min(...rs) + 1
      }
      return { ...o, tileCount: o.tileIds.length, blockCols, blockRows }
    })

    return NextResponse.json({ orders })
  }

  if (view === 'epochs') {
    const epochs = await prisma.distributionEpoch.findMany({
      orderBy: { epochDate: 'desc' },
      take: 10,
    })
    return NextResponse.json({ epochs })
  }

  if (view === 'distribution') {
    const epochs = await prisma.distributionEpoch.findMany({
      orderBy: { epochDate: 'desc' },
      take: 30,
      include: { _count: { select: { holderSnapshots: true, claims: true } } },
    })
    return NextResponse.json({ epochs })
  }

  if (view === 'current_epoch') {
    const today = todayUtc()
    const epoch = await getOrCreateEpoch(today)
    const { adRevenue, tradingFeeRevenue, grossPool } = await getGrossRevenueForDate(today)
    const feePercentStr = await getSetting('management_fee_percent')
    const feePercent = parseFloat(feePercentStr)
    const estimatedMgmtFee = (grossPool * feePercent) / 100
    const estimatedClaimPool = grossPool - estimatedMgmtFee
    return NextResponse.json({
      epoch,
      liveRevenue: { adRevenue, tradingFeeRevenue, grossPool, feePercent, estimatedMgmtFee, estimatedClaimPool },
      msUntilClose: msUntilUtcClose(),
    })
  }

  if (view === 'revenue_events') {
    const typeFilter = searchParams.get('type')
    const events = await prisma.revenueEvent.findMany({
      where: typeFilter ? { type: typeFilter as never } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ events })
  }

  if (view === 'excluded_wallets') {
    const wallets = await prisma.excludedWallet.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ wallets })
  }

  if (view === 'billing') {
    const runs = await prisma.dailyBillingRun.findMany({
      orderBy: { runDate: 'desc' },
      take: 10,
    })
    return NextResponse.json({ runs })
  }

  if (view === 'topups') {
    const [pending, confirmed, unmatched] = await Promise.all([
      prisma.topup.findMany({
        where: { status: { in: ['PENDING', 'EXPIRED'] }, method: 'usdc_solana' },
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.topup.findMany({
        where: { status: 'CONFIRMED' },
        include: { user: { select: { email: true } } },
        orderBy: { confirmedAt: 'desc' },
        take: 50,
      }),
      prisma.processedTransaction.findMany({
        where: { topupId: null },
        orderBy: { processedAt: 'desc' },
        take: 50,
      }),
    ])
    return NextResponse.json({ pending, confirmed, unmatched })
  }

  if (view === 'reset_state') {
    const walletAddress = searchParams.get('walletAddress')
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 })

    const user = await prisma.user.findFirst({ where: { walletAddress }, select: { id: true } })
    if (!user) {
      return NextResponse.json({
        userId: null, balance: 0, pendingTopups: 0, confirmedTopups: 0, activeRentals: 0, pendingRentals: 0,
      })
    }

    const [wallet, pendingTopups, confirmedTopups, activeRentals, pendingRentals] = await Promise.all([
      prisma.advertiserWallet.findUnique({ where: { userId: user.id }, select: { usdcBalance: true } }),
      prisma.topup.count({ where: { userId: user.id, status: 'PENDING' } }),
      prisma.topup.count({ where: { userId: user.id, status: 'CONFIRMED' } }),
      prisma.adRental.count({ where: { userId: user.id, status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { userId: user.id, status: 'PENDING_APPROVAL' } }),
    ])

    return NextResponse.json({
      userId: user.id,
      balance: wallet ? Number(wallet.usdcBalance) : 0,
      pendingTopups,
      confirmedTopups,
      activeRentals,
      pendingRentals,
    })
  }

  if (view === 'user_balances') {
    const users = await prisma.user.findMany({
      where: { role: 'ADVERTISER' },
      select: {
        id: true,
        walletAddress: true,
        email: true,
        createdAt: true,
        advertiserWallet: { select: { usdcBalance: true } },
        _count: { select: { adRentals: true, topups: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        walletAddress: u.walletAddress,
        email: u.email,
        balance: u.advertiserWallet ? Number(u.advertiserWallet.usdcBalance) : 0,
        rentalCount: u._count.adRentals,
        topupCount: u._count.topups,
        createdAt: u.createdAt,
      })),
    })
  }

  if (view === 'settlements') {
    const statusFilter = searchParams.get('status')
    const settlements = await prisma.revenueSettlement.findMany({
      where: statusFilter ? { settlementStatus: statusFilter as never } : undefined,
      include: {
        revenueEvent: {
          select: { type: true, amount: true, createdAt: true, userId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ settlements })
  }

  if (view === 'accounting') {
    const today = utcDayStart(new Date())

    const [
      unusedBalances,
      earnedAdFees,
      earnedTradingFees,
      settledTotal,
      failedCount,
      pendingCount,
      treasurySent,
      distributionSent,
    ] = await Promise.all([
      prisma.advertiserWallet.aggregate({ _sum: { usdcBalance: true } }),
      prisma.revenueEvent.aggregate({
        where: { type: 'AD_RENT_REVENUE' },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'TRADING_FEE_REVENUE' },
        _sum: { amount: true },
      }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { amount: true },
      }),
      prisma.revenueSettlement.count({
        where: { settlementStatus: { in: ['FAILED', 'PARTIAL'] } },
      }),
      prisma.revenueSettlement.count({
        where: { settlementStatus: 'UNSETTLED' },
      }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { treasuryAmount: true },
      }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { distributionAmount: true },
      }),
    ])

    const walletConfig = {
      topupWallet: env.topupWallet,
      revenueWallet: env.revenueWallet,
      treasuryWallet: env.treasuryWallet,
      distributionWallet: env.distributionWallet,
      feeCreatorWallet: env.feeCreatorWallet,
      adminWallet: env.adminWallet,
      topupWalletKeyConfigured: !!env.topupWalletPrivateKey,
      revenueWalletKeyConfigured: !!env.revenueWalletPrivateKey,
      feeCreatorWalletKeyConfigured: !!env.feeCreatorWalletPrivateKey,
    }

    return NextResponse.json({
      unusedAdvertiserBalances: Number(unusedBalances._sum.usdcBalance ?? 0),
      earnedAdFees: Number(earnedAdFees._sum.amount ?? 0),
      earnedTradingFees: Number(earnedTradingFees._sum.amount ?? 0),
      totalSettled: Number(settledTotal._sum.amount ?? 0),
      failedSettlements: failedCount,
      pendingSettlements: pendingCount,
      treasurySent: Number(treasurySent._sum.treasuryAmount ?? 0),
      distributionSent: Number(distributionSent._sum.distributionAmount ?? 0),
      walletConfig,
      today: today.toISOString(),
    })
  }

  return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
}

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { action } = body

  if (action === 'approve_order') {
    const { creativeId } = body
    if (!creativeId) return NextResponse.json({ error: 'creativeId required' }, { status: 400 })

    const now = new Date()

    // Load rentals and advertiser wallet for balance check
    const rentals = await prisma.adRental.findMany({
      where: { creativeId, status: 'PENDING_APPROVAL' },
      include: { user: { include: { advertiserWallet: true } } },
    })
    if (rentals.length === 0) {
      return NextResponse.json({ error: 'No pending rentals found for this creative' }, { status: 404 })
    }

    const userId = rentals[0].userId
    const wallet = rentals[0].user.advertiserWallet
    const [freeEnabled, tilePrice] = await Promise.all([isFreeRentalEnabled(), getTilePrice()])
    const dailyRate = freeEnabled ? 0 : tilePrice
    const first24hCostCents = freeEnabled ? 0 : Math.round(rentals.length * tilePrice * 100)
    const first24hCost = first24hCostCents / 100

    if (!freeEnabled && first24hCostCents > 0) {
      const balanceCents = Math.round(Number(wallet?.usdcBalance ?? 0) * 100)
      if (balanceCents < first24hCostCents) {
        const shortfall = (first24hCostCents - balanceCents) / 100
        return NextResponse.json(
          {
            error: `Insufficient advertiser balance. Need $${first24hCost.toFixed(2)}, have $${Number(wallet?.usdcBalance ?? 0).toFixed(2)}. Shortfall: $${shortfall.toFixed(2)}`,
            required: first24hCost,
            shortfall,
          },
          { status: 402 }
        )
      }
    }

    const epoch = await getOrCreateEpoch(utcDayStart(now))
    const rentalIds = rentals.map((r) => r.id)

    const { revenueEvent } = await prisma.$transaction(async (tx) => {
      await tx.adRental.updateMany({
        where: { id: { in: rentalIds } },
        data: {
          status: 'ACTIVE',
          startDate: now,
          lastBilledAt: now,
          nextBillingAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          dailyRate,
        },
      })

      let revenueEvent = null
      if (!freeEnabled && first24hCost > 0) {
        await tx.advertiserWallet.update({
          where: { userId },
          data: { usdcBalance: { decrement: first24hCost } },
        })
        revenueEvent = await tx.revenueEvent.create({
          data: {
            type: 'AD_RENT_REVENUE',
            source: 'admin_approval',
            amount: first24hCost,
            currency: 'USDC',
            epochId: epoch.id,
            userId,
            metadata: { rentalIds, creativeId, tileCount: rentals.length, dailyRate },
          },
        })
      }
      return { revenueEvent }
    })

    if (revenueEvent) {
      void settleRevenueEvent(revenueEvent.id).catch((err) =>
        console.error('[settlement] approve_order error', revenueEvent.id, err)
      )
    }

    return NextResponse.json({ ok: true })
  }

  if (action === 'reject_order') {
    const { creativeId } = body
    if (!creativeId) return NextResponse.json({ error: 'creativeId required' }, { status: 400 })
    await prisma.adRental.updateMany({
      where: { creativeId, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED' },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'approve_all_orders') {
    // Approve all pending orders, deducting balance per user and creating revenue events
    const now = new Date()
    const allPending = await prisma.adRental.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { user: { include: { advertiserWallet: true } } },
    })

    if (allPending.length === 0) return NextResponse.json({ ok: true, count: 0 })

    const [freeEnabled, tilePrice] = await Promise.all([isFreeRentalEnabled(), getTilePrice()])
    const epoch = await getOrCreateEpoch(utcDayStart(now))

    // Group by userId
    const byUser = new Map<string, typeof allPending>()
    for (const r of allPending) {
      const arr = byUser.get(r.userId) ?? []
      arr.push(r)
      byUser.set(r.userId, arr)
    }

    let totalCount = 0
    let skippedCount = 0
    const revenueEventIds: string[] = []

    for (const [userId, rentals] of byUser) {
      const wallet = rentals[0].user.advertiserWallet
      const dailyRate = freeEnabled ? 0 : tilePrice
      const first24hCostCents = freeEnabled ? 0 : Math.round(rentals.length * tilePrice * 100)
      const first24hCost = first24hCostCents / 100

      if (!freeEnabled && first24hCostCents > 0) {
        const balanceCents = Math.round(Number(wallet?.usdcBalance ?? 0) * 100)
        if (balanceCents < first24hCostCents) {
          skippedCount += rentals.length
          continue
        }
      }

      const rentalIds = rentals.map((r) => r.id)
      const { revenueEvent } = await prisma.$transaction(async (tx) => {
        await tx.adRental.updateMany({
          where: { id: { in: rentalIds } },
          data: {
            status: 'ACTIVE',
            startDate: now,
            lastBilledAt: now,
            nextBillingAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            dailyRate,
          },
        })
        let revenueEvent = null
        if (!freeEnabled && first24hCost > 0) {
          await tx.advertiserWallet.update({
            where: { userId },
            data: { usdcBalance: { decrement: first24hCost } },
          })
          revenueEvent = await tx.revenueEvent.create({
            data: {
              type: 'AD_RENT_REVENUE',
              source: 'admin_approval',
              amount: first24hCost,
              currency: 'USDC',
              epochId: epoch.id,
              userId,
              metadata: { rentalIds, tileCount: rentals.length, dailyRate },
            },
          })
        }
        return { revenueEvent }
      })

      if (revenueEvent) revenueEventIds.push(revenueEvent.id)
      totalCount += rentals.length
    }

    // Fire-and-forget settlements
    for (const id of revenueEventIds) {
      void settleRevenueEvent(id).catch((err) =>
        console.error('[settlement] approve_all error', id, err)
      )
    }

    return NextResponse.json({ ok: true, count: totalCount, skipped: skippedCount })
  }

  if (action === 'reject_all_orders') {
    const result = await prisma.adRental.updateMany({
      where: { status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED' },
    })
    return NextResponse.json({ ok: true, count: result.count })
  }

  if (action === 'remove_order') {
    const { creativeId } = body
    if (!creativeId) return NextResponse.json({ error: 'creativeId required' }, { status: 400 })
    await prisma.adRental.updateMany({
      where: { creativeId, status: 'ACTIVE' },
      data: { status: 'REJECTED', endDate: new Date() },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'expire') {
    const { rentalId } = body
    await prisma.adRental.update({
      where: { id: rentalId },
      data: { status: 'EXPIRED', endDate: new Date() },
    })
    return NextResponse.json({ ok: true })
  }

  // ── Distribution actions ────────────────────────────────────────────────────

  if (action === 'trigger_close_epoch') {
    const targetDate = body.epochDate ? new Date(body.epochDate) : yesterdayUtc()
    try {
      const epoch = await closeEpochForDate(targetDate)
      return NextResponse.json({ ok: true, epoch })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  if (action === 'create_epoch') {
    // Upsert an OPEN epoch for today (or a given date)
    const epoch = await getOrCreateEpoch(body.epochDate ? new Date(body.epochDate) : new Date())
    return NextResponse.json({ ok: true, epoch })
  }

  if (action === 'calculate_pool') {
    // Compute revenue breakdown from RevenueEvents for an epoch's date
    const { epochId } = body
    if (!epochId) return NextResponse.json({ error: 'epochId required' }, { status: 400 })

    const epoch = await prisma.distributionEpoch.findUnique({ where: { id: epochId } })
    if (!epoch) return NextResponse.json({ error: 'Epoch not found' }, { status: 404 })

    const feePercentStr = await getSetting('management_fee_percent')
    const feePercent = parseFloat(feePercentStr)

    const { adRevenue, tradingFeeRevenue, grossPool } = await getGrossRevenueForDate(epoch.epochDate)
    const managementFeeAmount = (grossPool * feePercent) / 100
    const claimPoolAmount = grossPool - managementFeeAmount

    // Record management fee event if there's revenue
    if (managementFeeAmount > 0) {
      await createRevenueEvent({
        type: 'MANAGEMENT_FEE',
        source: 'admin',
        amount: managementFeeAmount,
        epochId,
        metadata: { feePercent, grossPool },
      })
    }

    if (claimPoolAmount > 0) {
      await createRevenueEvent({
        type: 'CLAIM_POOL_ALLOCATION',
        source: 'admin',
        amount: claimPoolAmount,
        epochId,
        metadata: { adRevenue, tradingFeeRevenue, grossPool, feePercent },
      })
    }

    const updated = await prisma.distributionEpoch.update({
      where: { id: epochId },
      data: {
        adRevenue,
        tradingFeeRevenue,
        grossPool,
        managementFeePercent: feePercent,
        managementFeeAmount,
        claimPoolAmount,
        totalPool: claimPoolAmount,
        status: 'BILLED',
      },
    })
    return NextResponse.json({ ok: true, epoch: updated })
  }

  if (action === 'run_snapshot') {
    const { epochId } = body
    if (!epochId) return NextResponse.json({ error: 'epochId required' }, { status: 400 })

    const boardMint = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''
    if (!boardMint) {
      return NextResponse.json(
        { error: '$BOARD token not launched yet. Set NEXT_PUBLIC_BOARD_MINT to enable snapshots.' },
        { status: 400 }
      )
    }

    const heliusApiKey = env.heliusApiKey
    if (!heliusApiKey) {
      return NextResponse.json({ error: 'HELIUS_API_KEY not configured' }, { status: 400 })
    }

    const epoch = await prisma.distributionEpoch.findUnique({ where: { id: epochId } })
    if (!epoch) return NextResponse.json({ error: 'Epoch not found' }, { status: 404 })

    // Fetch excluded wallets to skip system wallets
    const excluded = await prisma.excludedWallet.findMany({ select: { walletAddress: true } })
    const excludedSet = new Set(excluded.map((e) => e.walletAddress))

    const holders = await fetchTokenHolders(boardMint, heliusApiKey)
    const eligibleHolders = holders.filter((h) => !excludedSet.has(h.walletAddress))

    const totalSupply = eligibleHolders.reduce((sum, h) => sum + BigInt(h.balance), 0n)
    const claimPool = Number(epoch.claimPoolAmount)

    const snapshotDate = new Date()
    await prisma.$transaction([
      prisma.distributionEpoch.update({
        where: { id: epochId },
        data: {
          status: 'SNAPSHOTTED',
          snapshotDate,
          eligibleSupply: totalSupply.toString(),
        },
      }),
      ...eligibleHolders.map((h) =>
        prisma.holderSnapshot.upsert({
          where: { epochId_walletAddress: { epochId, walletAddress: h.walletAddress } },
          update: { tokenBalance: h.balance },
          create: {
            epochId,
            walletAddress: h.walletAddress,
            tokenBalance: h.balance,
            claimAmount:
              totalSupply > 0n
                ? (Number(BigInt(h.balance) * BigInt(Math.round(claimPool * 1e6))) / Number(totalSupply)) / 1e6
                : 0,
          },
        })
      ),
    ])

    return NextResponse.json({
      ok: true,
      holdersSnapshotted: eligibleHolders.length,
      eligibleSupply: totalSupply.toString(),
    })
  }

  if (action === 'publish_epoch') {
    const { epochId } = body
    if (!epochId) return NextResponse.json({ error: 'epochId required' }, { status: 400 })
    const epoch = await prisma.distributionEpoch.update({
      where: { id: epochId },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })
    return NextResponse.json({ ok: true, epoch })
  }

  if (action === 'close_epoch') {
    const { epochId } = body
    if (!epochId) return NextResponse.json({ error: 'epochId required' }, { status: 400 })
    const epoch = await prisma.distributionEpoch.update({
      where: { id: epochId },
      data: { status: 'CLOSED', closedAt: new Date() },
    })
    return NextResponse.json({ ok: true, epoch })
  }

  if (action === 'add_excluded_wallet') {
    const { walletAddress, label, reason } = body
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 })
    const wallet = await prisma.excludedWallet.upsert({
      where: { walletAddress },
      create: { walletAddress, label: label ?? null, reason: reason ?? null },
      update: { label: label ?? undefined, reason: reason ?? undefined },
    })
    return NextResponse.json({ ok: true, wallet })
  }

  if (action === 'remove_excluded_wallet') {
    const { walletAddress } = body
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 })
    await prisma.excludedWallet.delete({ where: { walletAddress } })
    return NextResponse.json({ ok: true })
  }

  // ── Legacy create_epoch (old totalPool form) — kept for backward compat ────

  if (action === 'snapshot_epoch') {
    const { epochId, mockHolders } = body
    if (!Array.isArray(mockHolders)) {
      return NextResponse.json({ error: 'mockHolders array required' }, { status: 400 })
    }

    const epoch = await prisma.distributionEpoch.findUnique({ where: { id: epochId } })
    if (!epoch) return NextResponse.json({ error: 'Epoch not found' }, { status: 404 })

    const totalTokens = mockHolders.reduce(
      (sum: number, h: { balance: number }) => sum + h.balance,
      0
    )
    const pool = Number(epoch.totalPool)

    await prisma.$transaction([
      prisma.distributionEpoch.update({
        where: { id: epochId },
        data: { status: 'SNAPSHOTTED', snapshotDate: new Date() },
      }),
      ...mockHolders.map((h: { wallet: string; balance: number }) =>
        prisma.holderSnapshot.upsert({
          where: { epochId_walletAddress: { epochId, walletAddress: h.wallet } },
          update: {},
          create: {
            epochId,
            walletAddress: h.wallet,
            tokenBalance: h.balance,
            claimAmount: totalTokens > 0 ? (h.balance / totalTokens) * pool : 0,
          },
        })
      ),
    ])

    return NextResponse.json({ ok: true })
  }

  // ── Topup management ────────────────────────────────────────────────────────

  if (action === 'assign_topup') {
    const { txId, userId } = body
    if (!txId || !userId) return NextResponse.json({ error: 'txId and userId required' }, { status: 400 })

    // All reads and writes in a single transaction to prevent race-condition double-credit
    const result = await prisma.$transaction(async (tx) => {
      const processedTx = await tx.processedTransaction.findUnique({ where: { id: txId } })
      if (!processedTx) throw new Error('Transaction not found')
      if (processedTx.topupId) throw new Error('Already assigned')

      const topup = await tx.topup.create({
        data: {
          userId,
          amount: processedTx.amountUsdc,
          method: 'usdc_solana',
          status: 'CONFIRMED',
          txSignature: processedTx.signature,
          actualAmount: processedTx.amountUsdc,
          advertiserWallet: processedTx.senderWallet,
          depositWallet: processedTx.receiverWallet,
          confirmedAt: processedTx.processedAt,
        },
      })
      await tx.processedTransaction.update({
        where: { id: txId },
        data: { topupId: topup.id },
      })
      await tx.advertiserWallet.upsert({
        where: { userId },
        create: { userId, usdcBalance: processedTx.amountUsdc },
        update: { usdcBalance: { increment: processedTx.amountUsdc } },
      })
      return topup
    })

    return NextResponse.json({ ok: true, topup: result })
  }

  if (action === 'expire_topup') {
    const { topupId } = body
    await prisma.topup.update({
      where: { id: topupId },
      data: { status: 'EXPIRED' },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'check_tx_signature') {
    const { signature } = body
    if (!signature?.trim()) return NextResponse.json({ error: 'signature required' }, { status: 400 })

    const result = await verifyAndProcessSignature(signature.trim())
    if (!result.ok) {
      if ('found' in result) return NextResponse.json({ ok: false, found: false, message: result.message })
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
    }
    return NextResponse.json({ ok: true, found: true, results: result.results })
  }

  if (action === 'reconcile') {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    let res: Response
    try {
      res = await fetch(`${appUrl}/api/cron/reconcile-usdc-topups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
      })
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      return NextResponse.json(
        { ok: false, error: `Network error reaching cron endpoint: ${msg}`, appUrl },
        { status: 502 }
      )
    }
    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Cron endpoint returned HTTP ${res.status}`, body: text.slice(0, 300) },
        { status: 502 }
      )
    }
    try {
      return NextResponse.json(JSON.parse(text))
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Cron endpoint returned non-JSON', body: text.slice(0, 300) },
        { status: 502 }
      )
    }
  }

  // ── Test / dev tooling ──────────────────────────────────────────────────────

  if (action === 'reset_test_account') {
    const { walletAddress } = body
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 })

    const user = await prisma.user.findFirst({ where: { walletAddress }, select: { id: true } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    await prisma.$transaction([
      prisma.advertiserWallet.upsert({
        where: { userId: user.id },
        update: { usdcBalance: 0 },
        create: { userId: user.id, usdcBalance: 0 },
      }),
      prisma.topup.updateMany({
        where: { userId: user.id, method: 'usdc_solana', status: 'PENDING' },
        data: { status: 'EXPIRED' },
      }),
      prisma.topup.updateMany({
        where: { userId: user.id, method: 'mock', status: { notIn: ['CONFIRMED', 'REJECTED', 'FAILED'] } },
        data: { status: 'REJECTED' },
      }),
    ])

    return NextResponse.json({ ok: true })
  }

  if (action === 'clear_test_rentals') {
    const { walletAddress } = body
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 })

    const user = await prisma.user.findFirst({ where: { walletAddress }, select: { id: true } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const result = await prisma.adRental.updateMany({
      where: { userId: user.id, status: { in: ['ACTIVE', 'PENDING_APPROVAL'] } },
      data: { status: 'EXPIRED', endDate: new Date() },
    })

    return NextResponse.json({ ok: true, cleared: result.count })
  }

  if (action === 'clear_full_board') {
    const { confirm } = body
    if (confirm !== 'CONFIRM') {
      return NextResponse.json({ error: 'Type CONFIRM to proceed' }, { status: 400 })
    }

    const result = await prisma.adRental.updateMany({
      where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] } },
      data: { status: 'EXPIRED', endDate: new Date() },
    })

    return NextResponse.json({ ok: true, cleared: result.count })
  }

  // ── Settlement actions ──────────────────────────────────────────────────────

  if (action === 'retry_settlement') {
    const { revenueEventId } = body
    if (!revenueEventId) return NextResponse.json({ error: 'revenueEventId required' }, { status: 400 })

    // Verify the event exists and is settleable
    const event = await prisma.revenueEvent.findUnique({ where: { id: revenueEventId } })
    if (!event) return NextResponse.json({ error: 'Revenue event not found' }, { status: 404 })

    const result = await settleRevenueEvent(revenueEventId)
    return NextResponse.json(result)
  }

  if (action === 'dry_run_settlement') {
    const { revenueEventId } = body
    if (!revenueEventId) return NextResponse.json({ error: 'revenueEventId required' }, { status: 400 })

    const result = await dryRunSettlement(revenueEventId)
    return NextResponse.json(result)
  }

  if (action === 'seed_excluded_wallets') {
    // Also seed TOPUP_WALLET in addition to the legacy AD_REVENUE_WALLET
    const systemWallets = [
      { key: 'TOPUP_WALLET', label: 'Top-Up Wallet', reason: 'System wallet — receives advertiser deposits (prepaid balances)' },
      { key: 'AD_REVENUE_WALLET', label: 'Top-Up Wallet (legacy)', reason: 'System wallet — legacy alias for Top-Up Wallet' },
      { key: 'REVENUE_WALLET', label: 'Revenue Wallet', reason: 'System wallet — staging wallet for earned revenue' },
      { key: 'FEE_CREATOR_WALLET', label: 'Fee Creator Wallet', reason: 'System wallet — receives trading fees' },
      { key: 'DISTRIBUTION_WALLET', label: 'Distribution Wallet', reason: 'System wallet — pays out claims' },
      { key: 'MANAGEMENT_WALLET', label: 'Management Wallet', reason: 'System wallet — reserved' },
      { key: 'TREASURY_WALLET', label: 'Treasury Wallet', reason: 'System wallet — platform fee reserve' },
      { key: 'ADMIN_WALLET', label: 'Admin Wallet', reason: 'System wallet — admin control' },
    ]

    const created: string[] = []
    for (const w of systemWallets) {
      const addr = process.env[w.key]
      if (!addr) continue
      await prisma.excludedWallet.upsert({
        where: { walletAddress: addr },
        create: { walletAddress: addr, label: w.label, reason: w.reason },
        update: { label: w.label, reason: w.reason },
      })
      created.push(addr)
    }
    return NextResponse.json({ ok: true, seeded: created.length, wallets: created })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
