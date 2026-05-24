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
import { fetchWalletUsdcBalances } from '@/lib/wallet-balances'
import { checkKeyDiagnostic } from '@/lib/wallet-key-check'
import { getPayoutReadiness } from '@/lib/payout'
import { captureAppError } from '@/lib/sentry'

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

  function parsePag() {
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25')))
    return { page, pageSize, skip: (page - 1) * pageSize }
  }
  function paged<T>(rows: T[], page: number, pageSize: number, totalRows: number) {
    return { rows, page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) }
  }

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

    const allOrders = Array.from(orderMap.values()).map((o) => {
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

    const { page, pageSize, skip } = parsePag()
    const totalRows = allOrders.length
    const orders = allOrders.slice(skip, skip + pageSize)
    return NextResponse.json({ orders, page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) })
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
      creative: {
        imageUrl: string | null; destUrl: string; altText: string | null; displayMode: string
        durationType: string | null; durationDays: number | null; totalPrice: number | null
        recognizedAmount: number | null; dailyRecognizedRevenue: number | null
        campaignStartAt: Date | null; campaignEndAt: Date | null
        autoRenew: boolean; renewalCount: number; campaignStatus: string | null
      } | null
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
            ? {
                imageUrl: rental.creative.imageUrl,
                destUrl: rental.creative.destUrl,
                altText: rental.creative.altText,
                displayMode: rental.creative.displayMode,
                durationType: rental.creative.durationType ?? null,
                durationDays: rental.creative.durationDays ?? null,
                totalPrice: rental.creative.totalPrice != null ? Number(rental.creative.totalPrice) : null,
                recognizedAmount: rental.creative.recognizedAmount != null ? Number(rental.creative.recognizedAmount) : null,
                dailyRecognizedRevenue: rental.creative.dailyRecognizedRevenue != null ? Number(rental.creative.dailyRecognizedRevenue) : null,
                campaignStartAt: rental.creative.campaignStartAt ?? null,
                campaignEndAt: rental.creative.campaignEndAt ?? null,
                autoRenew: rental.creative.autoRenew,
                renewalCount: rental.creative.renewalCount,
                campaignStatus: rental.creative.campaignStatus ?? null,
              }
            : null,
          user: { email: rental.user.email ?? null, walletAddress: rental.user.walletAddress ?? null },
        })
      }
      const o = orderMap.get(key)!
      o.tileIds.push(rental.tileId)
      o.rentalIds.push(rental.id)
      o.dailyRateTotal += Number(rental.dailyRate)
    }

    const allOrders = Array.from(orderMap.values()).map((o) => {
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

    const { page, pageSize, skip } = parsePag()
    const totalRows = allOrders.length
    const orders = allOrders.slice(skip, skip + pageSize)
    return NextResponse.json({ orders, page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) })
  }

  if (view === 'epochs') {
    const epochs = await prisma.distributionEpoch.findMany({
      orderBy: { epochDate: 'desc' },
      take: 10,
    })
    return NextResponse.json({ epochs })
  }

  if (view === 'distribution') {
    const { page, pageSize, skip } = parsePag()
    const [epochs, totalRows] = await Promise.all([
      prisma.distributionEpoch.findMany({
        orderBy: { epochDate: 'desc' },
        skip, take: pageSize,
        include: { _count: { select: { holderSnapshots: true, claims: true } } },
      }),
      prisma.distributionEpoch.count(),
    ])
    return NextResponse.json({ ...paged(epochs, page, pageSize, totalRows) })
  }

  if (view === 'cron_health') {
    const [lastBilling, lastRecognition, lastRetrySettlement, lastEpoch, lastReconcile, retryableCount, pendingTopups] = await Promise.all([
      prisma.dailyBillingRun.findFirst({ orderBy: { runDate: 'desc' } }),
      prisma.campaignRevenueRecognition.findFirst({ orderBy: { createdAt: 'desc' } }),
      prisma.revenueSettlement.findFirst({
        where: { lastRetryAt: { not: null } },
        orderBy: { lastRetryAt: 'desc' },
        select: { lastRetryAt: true, settlementStatus: true },
      }),
      prisma.distributionEpoch.findFirst({
        where: { publishedAt: { not: null } },
        orderBy: { publishedAt: 'desc' },
        select: { publishedAt: true, epochDate: true, status: true },
      }),
      prisma.processedTransaction.findFirst({
        orderBy: { processedAt: 'desc' },
        select: { processedAt: true },
      }),
      prisma.revenueSettlement.count({ where: { retryable: true, settlementStatus: { not: 'SETTLED' } } }),
      prisma.topup.count({ where: { status: 'PENDING', method: 'usdc_solana' } }),
    ])
    return NextResponse.json({
      billing: {
        lastRunDate: lastBilling?.runDate ?? null,
        lastStatus: lastBilling?.status ?? null,
        lastRevenue: lastBilling ? Number(lastBilling.totalRevenue) : null,
        lastTiles: lastBilling?.tilesCharged ?? null,
        schedule: '0 1 * * * (01:00 UTC daily)',
      },
      recognition: {
        lastRunAt: lastRecognition?.createdAt ?? null,
        schedule: '*/10 * * * * (every 10 min)',
      },
      retrySettlements: {
        lastRetryAt: lastRetrySettlement?.lastRetryAt ?? null,
        retryableCount,
        schedule: '*/10 * * * * (every 10 min)',
      },
      epochClose: {
        lastClosedAt: lastEpoch?.publishedAt ?? null,
        lastEpochDate: lastEpoch?.epochDate ?? null,
        lastEpochStatus: lastEpoch?.status ?? null,
        schedule: '30 1 * * * (01:30 UTC daily)',
      },
      reconcile: {
        lastTransactionAt: lastReconcile?.processedAt ?? null,
        pendingTopups,
        schedule: '*/5 * * * * (every 5 min)',
      },
    })
  }

  if (view === 'readiness_check') {
    const readiness = getPayoutReadiness()
    const sessionWarnings: string[] = []
    const sessionSecret = process.env.SESSION_SECRET?.trim()
    if (!sessionSecret) {
      sessionWarnings.push('SESSION_SECRET is not set — session JWTs are insecure. Set it in Vercel env vars immediately.')
    }
    return NextResponse.json({ ...readiness, sessionWarnings })
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
    const { page, pageSize, skip } = parsePag()
    const typeFilter = searchParams.get('type')
    const settlFilter = searchParams.get('settlementStatus')
    const where: Record<string, unknown> = {}
    if (typeFilter) where.type = typeFilter
    if (settlFilter) where.settlement = { settlementStatus: settlFilter }
    const [events, totalRows] = await Promise.all([
      prisma.revenueEvent.findMany({
        where,
        include: {
          settlement: {
            select: { settlementStatus: true, moveToRevenueTxSignature: true, treasuryTxSignature: true, distributionTxSignature: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip, take: pageSize,
      }),
      prisma.revenueEvent.count({ where }),
    ])
    return NextResponse.json({ events, page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) })
  }

  if (view === 'excluded_wallets') {
    const wallets = await prisma.excludedWallet.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ wallets })
  }

  if (view === 'billing') {
    const { page, pageSize, skip } = parsePag()
    const [runs, totalRows] = await Promise.all([
      prisma.dailyBillingRun.findMany({ orderBy: { runDate: 'desc' }, skip, take: pageSize }),
      prisma.dailyBillingRun.count(),
    ])
    return NextResponse.json({ runs, page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) })
  }

  if (view === 'topups') {
    const status = searchParams.get('status') ?? 'pending'
    const search = searchParams.get('search') ?? ''
    const { page, pageSize, skip } = parsePag()

    if (status === 'unmatched') {
      const where: Record<string, unknown> = { topupId: null }
      if (search) where.OR = [{ signature: { contains: search } }, { senderWallet: { contains: search } }]
      const [rows, totalRows] = await Promise.all([
        prisma.processedTransaction.findMany({ where, orderBy: { processedAt: 'desc' }, skip, take: pageSize }),
        prisma.processedTransaction.count({ where }),
      ])
      return NextResponse.json({ rows, status: 'unmatched', page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) })
    }

    const statusMap: Record<string, unknown> = {
      pending: { in: ['PENDING'] },
      confirmed: { in: ['CONFIRMED'] },
      expired: { in: ['EXPIRED', 'FAILED'] },
    }
    const where: Record<string, unknown> = { status: statusMap[status] ?? statusMap.pending }
    if (status === 'pending') where.method = 'usdc_solana'
    if (search) where.OR = [{ txSignature: { contains: search } }, { advertiserWallet: { contains: search } }]

    const [rows, totalRows] = await Promise.all([
      prisma.topup.findMany({
        where,
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: pageSize,
      }),
      prisma.topup.count({ where }),
    ])
    return NextResponse.json({ rows, status, page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) })
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
    const { page, pageSize, skip } = parsePag()
    const search = searchParams.get('search') ?? ''
    const hasBalance = searchParams.get('hasBalance') === 'true'
    const where: Record<string, unknown> = { role: 'ADVERTISER' }
    if (search) where.OR = [
      { walletAddress: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
    if (hasBalance) where.advertiserWallet = { usdcBalance: { gt: 0 } }

    const [users, totalRows] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          walletAddress: true,
          email: true,
          createdAt: true,
          advertiserWallet: { select: { usdcBalance: true } },
          _count: { select: { adRentals: true, topups: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip, take: pageSize,
      }),
      prisma.user.count({ where }),
    ])

    // Enrich with topup breakdown and active burn
    const userIds = users.map((u) => u.id)
    const [realTopups, mockTopups, activeRentalRates] = await Promise.all([
      prisma.topup.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: 'CONFIRMED', method: 'usdc_solana', txSignature: { not: null } },
        _sum: { actualAmount: true },
      }),
      prisma.topup.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: 'CONFIRMED', method: 'mock' },
        _sum: { actualAmount: true },
      }),
      prisma.adRental.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: 'ACTIVE' },
        _sum: { dailyRate: true },
        _count: { _all: true },
      }),
    ])

    const realTopupMap = new Map(realTopups.map((r) => [r.userId, Number(r._sum.actualAmount ?? 0)]))
    const mockTopupMap = new Map(mockTopups.map((r) => [r.userId, Number(r._sum.actualAmount ?? 0)]))
    const burnMap = new Map(activeRentalRates.map((r) => [r.userId, { daily: Number(r._sum.dailyRate ?? 0), tiles: r._count._all }]))

    const enriched = users.map((u) => ({
      id: u.id,
      walletAddress: u.walletAddress,
      email: u.email,
      balance: u.advertiserWallet ? Number(u.advertiserWallet.usdcBalance) : 0,
      rentalCount: u._count.adRentals,
      topupCount: u._count.topups,
      createdAt: u.createdAt,
      confirmedRealTopups: realTopupMap.get(u.id) ?? 0,
      mockTopups: mockTopupMap.get(u.id) ?? 0,
      activeDailyBurn: burnMap.get(u.id)?.daily ?? 0,
      activeTiles: burnMap.get(u.id)?.tiles ?? 0,
    }))
    return NextResponse.json({ users: enriched, page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) })
  }

  if (view === 'settlements') {
    const { page, pageSize, skip } = parsePag()
    const statusFilter = searchParams.get('status')
    const typeFilter = searchParams.get('type')
    const retryableOnly = searchParams.get('retryableOnly') === 'true'
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const rowWhere: Record<string, unknown> = {}
    if (statusFilter && statusFilter !== 'all') rowWhere.settlementStatus = statusFilter
    if (retryableOnly) { rowWhere.retryable = true; rowWhere.settlementStatus = { not: 'SETTLED' } }
    if (typeFilter && typeFilter !== 'all') rowWhere.revenueEvent = { type: typeFilter }
    if (dateFrom || dateTo) {
      rowWhere.createdAt = {} as Record<string, Date>
      if (dateFrom) (rowWhere.createdAt as Record<string, Date>).gte = new Date(dateFrom)
      if (dateTo) (rowWhere.createdAt as Record<string, Date>).lte = new Date(dateTo + 'T23:59:59Z')
    }

    const [settlements, totalRows, totalsAgg, settledTreasuryAgg, settledDistAgg, pendingAgg, failedAgg, retryableCount] = await Promise.all([
      prisma.revenueSettlement.findMany({
        where: rowWhere,
        include: { revenueEvent: { select: { type: true, amount: true, createdAt: true, userId: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take: pageSize,
      }),
      prisma.revenueSettlement.count({ where: rowWhere }),
      prisma.revenueSettlement.aggregate({ _sum: { amount: true, treasuryAmount: true, distributionAmount: true }, _count: { _all: true } }),
      prisma.revenueSettlement.aggregate({ where: { settlementStatus: 'SETTLED' }, _sum: { treasuryAmount: true } }),
      prisma.revenueSettlement.aggregate({ where: { settlementStatus: 'SETTLED' }, _sum: { distributionAmount: true } }),
      prisma.revenueSettlement.aggregate({ where: { settlementStatus: { notIn: ['SETTLED', 'FAILED', 'PARTIAL'] } }, _sum: { amount: true } }),
      prisma.revenueSettlement.aggregate({ where: { settlementStatus: { in: ['FAILED', 'PARTIAL'] } }, _sum: { amount: true } }),
      prisma.revenueSettlement.count({ where: { retryable: true, settlementStatus: { not: 'SETTLED' } } }),
    ])
    return NextResponse.json({
      settlements,
      page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      totals: {
        totalEvents: totalsAgg._count._all,
        totalAmount: Number(totalsAgg._sum.amount ?? 0),
        treasuryDue: Number(totalsAgg._sum.treasuryAmount ?? 0),
        distributionDue: Number(totalsAgg._sum.distributionAmount ?? 0),
        treasurySettled: Number(settledTreasuryAgg._sum.treasuryAmount ?? 0),
        distributionSettled: Number(settledDistAgg._sum.distributionAmount ?? 0),
        pendingAmount: Number(pendingAgg._sum.amount ?? 0),
        failedAmount: Number(failedAgg._sum.amount ?? 0),
        retryableCount,
      },
    })
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
      confirmedTopupsTotal,
      mockTopupsTotal,
      activeDailyRateAgg,
      activeTileCount,
      earnedNotYetMoved,
      allTreasuryGenerated,
      allDistributionGenerated,
      pendingAmountAgg,
      failedAmountAgg,
      feePercentStr,
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
        where: { settlementStatus: { notIn: ['SETTLED', 'FAILED', 'PARTIAL'] } },
      }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { treasuryAmount: true },
      }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: 'SETTLED' },
        _sum: { distributionAmount: true },
      }),
      // Real on-chain topups (have txSignature, not mock)
      prisma.topup.aggregate({
        where: { status: 'CONFIRMED', method: 'usdc_solana', txSignature: { not: null } },
        _sum: { actualAmount: true },
      }),
      // Mock/admin topups
      prisma.topup.aggregate({
        where: { status: 'CONFIRMED', method: 'mock' },
        _sum: { actualAmount: true },
      }),
      // Active rental daily burn rate
      prisma.adRental.aggregate({ where: { status: 'ACTIVE' }, _sum: { dailyRate: true } }),
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      // Earned ad revenue not yet moved to revenue wallet (UNSETTLED or pending first leg)
      prisma.revenueSettlement.aggregate({
        where: {
          settlementStatus: { in: ['UNSETTLED', 'FAILED', 'PARTIAL'] },
        },
        _sum: { amount: true },
      }),
      // Total treasury and distribution generated across ALL settlements (not just settled)
      prisma.revenueSettlement.aggregate({ _sum: { treasuryAmount: true } }),
      prisma.revenueSettlement.aggregate({ _sum: { distributionAmount: true } }),
      // Pending (not yet sent) settlement amount
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: { notIn: ['SETTLED', 'FAILED', 'PARTIAL'] } },
        _sum: { amount: true },
      }),
      // Failed settlement amount
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: { in: ['FAILED', 'PARTIAL'] } },
        _sum: { amount: true },
      }),
      getSetting('management_fee_percent'),
    ])

    const topupKeyDiag = checkKeyDiagnostic(env.topupWalletPrivateKey, env.topupWallet)
    const revenueKeyDiag = checkKeyDiagnostic(env.revenueWalletPrivateKey, env.revenueWallet)
    const feeCreatorKeyDiag = checkKeyDiagnostic(env.feeCreatorWalletPrivateKey, env.feeCreatorWallet)

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
      topupKeyDiag,
      revenueKeyDiag,
      feeCreatorKeyDiag,
    }

    // Fetch on-chain USDC balance for top-up wallet (for reconciliation)
    let topupWalletOnChain: number | null = null
    if (env.topupWallet) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 6000)
        )
        const balances = await Promise.race([fetchWalletUsdcBalances(), timeoutPromise])
        topupWalletOnChain = balances.topupWallet.balance
      } catch {
        // leave null
      }
    }

    const unusedAdvertiserBalancesNum = Number(unusedBalances._sum.usdcBalance ?? 0)
    const earnedNotMovedNum = Number(earnedNotYetMoved._sum.amount ?? 0)
    // Expected top-up wallet = unused advertiser prepaid balances + earned but not yet moved to revenue wallet
    const expectedTopupWalletBalance = unusedAdvertiserBalancesNum + earnedNotMovedNum

    return NextResponse.json({
      unusedAdvertiserBalances: unusedAdvertiserBalancesNum,
      earnedAdFees: Number(earnedAdFees._sum.amount ?? 0),
      earnedTradingFees: Number(earnedTradingFees._sum.amount ?? 0),
      totalSettled: Number(settledTotal._sum.amount ?? 0),
      failedSettlements: failedCount,
      pendingSettlements: pendingCount,
      treasurySent: Number(treasurySent._sum.treasuryAmount ?? 0),
      distributionSent: Number(distributionSent._sum.distributionAmount ?? 0),
      // Full picture of generated vs sent
      totalTreasuryGenerated: Number(allTreasuryGenerated._sum.treasuryAmount ?? 0),
      totalDistributionGenerated: Number(allDistributionGenerated._sum.distributionAmount ?? 0),
      pendingAmount: Number(pendingAmountAgg._sum.amount ?? 0),
      failedAmount: Number(failedAmountAgg._sum.amount ?? 0),
      feePercent: Math.max(0, Math.min(100, parseFloat(feePercentStr) || 10)),
      walletConfig,
      today: today.toISOString(),
      // Reconciliation data
      reconciliation: {
        confirmedOnChainTopups: Number(confirmedTopupsTotal._sum.actualAmount ?? 0),
        mockTopups: Number(mockTopupsTotal._sum.actualAmount ?? 0),
        activeDailyBurn: Number(activeDailyRateAgg._sum.dailyRate ?? 0),
        activeTileCount,
        earnedNotYetMoved: earnedNotMovedNum,
        expectedTopupWalletBalance,
        topupWalletOnChain,
        variance: topupWalletOnChain !== null ? topupWalletOnChain - expectedTopupWalletBalance : null,
      },
    })
  }

  if (view === 'summary') {
    const TOTAL_TILES = 100000
    const today = utcDayStart(new Date())

    const [
      tilePrice,
      freeEnabled,
      feePercentStr,
      activeTileCount,
      pendingTileCount,
      activeDailyRateAgg,
      activeAdsDistinct,
      activeAdvertisersDistinct,
      epochRevenue,
      settledTreasury,
      settledDistribution,
      pendingSettlementAgg,
      failedSettlementAgg,
      pendingSettlementCount,
      failedSettlementCount,
    ] = await Promise.all([
      getTilePrice(),
      isFreeRentalEnabled(),
      getSetting('management_fee_percent'),
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.adRental.aggregate({ where: { status: 'ACTIVE' }, _sum: { dailyRate: true } }),
      prisma.adRental.findMany({ where: { status: 'ACTIVE' }, select: { creativeId: true }, distinct: ['creativeId'] }),
      prisma.adRental.findMany({ where: { status: 'ACTIVE' }, select: { userId: true }, distinct: ['userId'] }),
      getGrossRevenueForDate(today),
      prisma.revenueSettlement.aggregate({ where: { settlementStatus: 'SETTLED' }, _sum: { treasuryAmount: true } }),
      prisma.revenueSettlement.aggregate({ where: { settlementStatus: 'SETTLED' }, _sum: { distributionAmount: true } }),
      prisma.revenueSettlement.aggregate({
        where: { settlementStatus: { in: ['UNSETTLED', 'MOVING_TO_REVENUE', 'MOVED_TO_REVENUE', 'SPLITTING', 'PARTIAL'] } },
        _sum: { amount: true },
      }),
      prisma.revenueSettlement.aggregate({ where: { settlementStatus: 'FAILED' }, _sum: { amount: true } }),
      prisma.revenueSettlement.count({
        where: { settlementStatus: { in: ['UNSETTLED', 'MOVING_TO_REVENUE', 'MOVED_TO_REVENUE', 'SPLITTING', 'PARTIAL'] } },
      }),
      prisma.revenueSettlement.count({ where: { settlementStatus: 'FAILED' } }),
    ])

    const feePercent = parseFloat(feePercentStr)
    const { adRevenue, tradingFeeRevenue, grossPool } = epochRevenue
    const treasuryFeesGenerated = (grossPool * feePercent) / 100
    const distributionPoolGenerated = grossPool - treasuryFeesGenerated

    // Fetch on-chain USDC balances — best-effort with timeout
    let walletBalances = null
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 8000)
      )
      walletBalances = await Promise.race([fetchWalletUsdcBalances(), timeoutPromise])
    } catch {
      // balances unavailable — frontend shows "Unavailable"
    }

    return NextResponse.json({
      walletBalances,
      board: {
        totalTiles: TOTAL_TILES,
        activeTiles: activeTileCount,
        availableTiles: TOTAL_TILES - activeTileCount - pendingTileCount,
        pendingTiles: pendingTileCount,
        activeAds: activeAdsDistinct.length,
        activeAdvertisers: activeAdvertisersDistinct.length,
      },
      currentBurn: {
        dailyIncome: Number(activeDailyRateAgg._sum.dailyRate ?? 0),
        tilePrice,
        freeEnabled,
      },
      epoch: {
        date: today.toISOString(),
        advertisingFeesEarned: adRevenue,
        tradingFeesEarned: tradingFeeRevenue,
        grossFees: grossPool,
        treasuryFeesGenerated,
        distributionPoolGenerated,
        feePercent,
      },
      settlement: {
        settledToTreasury: Number(settledTreasury._sum.treasuryAmount ?? 0),
        settledToDistribution: Number(settledDistribution._sum.distributionAmount ?? 0),
        pendingSettlement: Number(pendingSettlementAgg._sum.amount ?? 0),
        failedSettlement: Number(failedSettlementAgg._sum.amount ?? 0),
        pendingCount: pendingSettlementCount,
        failedCount: failedSettlementCount,
      },
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
      void settleRevenueEvent(revenueEvent.id).catch((err) => {
        console.error('[settlement] approve_order error', revenueEvent.id, err)
        captureAppError(err, { route: '/api/admin', revenueEventId: revenueEvent.id, status: 'approve_order_settlement_error' })
      })
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
      void settleRevenueEvent(id).catch((err) => {
        console.error('[settlement] approve_all error', id, err)
        captureAppError(err, { route: '/api/admin', revenueEventId: id, status: 'approve_all_settlement_error' })
      })
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
      captureAppError(err, { route: '/api/admin', status: 'trigger_close_epoch_error' })
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

    const boardMint = process.env.BOARD_MINT || process.env.NEXT_PUBLIC_BOARD_MINT || ''
    if (!boardMint) {
      return NextResponse.json(
        { error: '$BOARD token not launched yet. Set BOARD_MINT to enable snapshots.' },
        { status: 400 }
      )
    }

    const heliusApiKey = env.heliusApiKey
    if (!heliusApiKey) {
      return NextResponse.json({ error: 'HELIUS_API_KEY not configured' }, { status: 400 })
    }

    const epoch = await prisma.distributionEpoch.findUnique({ where: { id: epochId } })
    if (!epoch) return NextResponse.json({ error: 'Epoch not found' }, { status: 404 })

    // Active excluded wallets — stored in snapshot for audit trail
    const excludedRows = await prisma.excludedWallet.findMany({
      where: { active: true },
      select: { walletAddress: true, reason: true },
    })
    const excludedMap = new Map(excludedRows.map((e) => [e.walletAddress, e.reason ?? 'excluded']))

    // Settled distribution for this epoch — use as claim pool if available
    const settledAgg = await prisma.revenueSettlement.aggregate({
      where: { revenueEvent: { epochId }, settlementStatus: 'SETTLED' },
      _sum: { distributionAmount: true },
    })
    const settledDistributionAmount = Number(settledAgg._sum.distributionAmount ?? 0)
    const claimPool = settledDistributionAmount > 0 ? settledDistributionAmount : Number(epoch.claimPoolAmount)

    const holders = await fetchTokenHolders(boardMint, heliusApiKey)
    const holderCount = holders.length
    const eligibleHolders = holders.filter((h) => !excludedMap.has(h.walletAddress))
    const excludedHolders = holders.filter((h) => excludedMap.has(h.walletAddress))

    // Eligible supply uses only non-excluded balances
    const eligibleSupply = eligibleHolders.reduce((sum, h) => sum + BigInt(h.balance), 0n)
    // Floor-round claim amounts in micro-USDC so dust stays in distribution wallet
    const poolMicro = BigInt(Math.floor(claimPool * 1_000_000))

    const eligibleWithClaims = eligibleHolders.map((h) => {
      const balanceBig = BigInt(h.balance)
      const claimMicro = eligibleSupply > 0n ? (balanceBig * poolMicro) / eligibleSupply : 0n
      const claimAmount = Number(claimMicro) / 1_000_000
      return { ...h, claimAmount }
    })

    const claimCount = eligibleWithClaims.filter((h) => h.claimAmount > 0).length
    const snapshotDate = new Date()

    await prisma.$transaction([
      prisma.distributionEpoch.update({
        where: { id: epochId },
        data: {
          status: 'SNAPSHOTTED',
          snapshotDate,
          eligibleSupply: eligibleSupply.toString(),
          holderCount,
          claimCount,
          ...(settledDistributionAmount > 0 ? { settledDistributionAmount } : {}),
        },
      }),
      // Eligible holders — with calculated claim amounts
      ...eligibleWithClaims.map((h) =>
        prisma.holderSnapshot.upsert({
          where: { epochId_walletAddress: { epochId, walletAddress: h.walletAddress } },
          update: { tokenBalance: h.balance, eligibleBalance: h.balance, claimAmount: h.claimAmount, excluded: false },
          create: {
            epochId,
            walletAddress: h.walletAddress,
            tokenBalance: h.balance,
            eligibleBalance: h.balance,
            claimAmount: h.claimAmount,
            excluded: false,
            status: 'CLAIMABLE',
          },
        })
      ),
      // Excluded holders — stored for audit trail with zero claim
      ...excludedHolders.map((h) =>
        prisma.holderSnapshot.upsert({
          where: { epochId_walletAddress: { epochId, walletAddress: h.walletAddress } },
          update: { tokenBalance: h.balance, eligibleBalance: 0, claimAmount: 0, excluded: true, exclusionReason: excludedMap.get(h.walletAddress) },
          create: {
            epochId,
            walletAddress: h.walletAddress,
            tokenBalance: h.balance,
            eligibleBalance: 0,
            claimAmount: 0,
            excluded: true,
            exclusionReason: excludedMap.get(h.walletAddress),
            status: 'VOID',
          },
        })
      ),
      // Pre-create CLAIMABLE Claims for eligible holders (idempotent — never overwrites existing)
      ...eligibleWithClaims.map((h) =>
        prisma.claim.upsert({
          where: { epochId_walletAddress: { epochId, walletAddress: h.walletAddress } },
          update: {},
          create: {
            epochId,
            walletAddress: h.walletAddress,
            amount: h.claimAmount,
            status: 'CLAIMABLE',
          },
        })
      ),
    ])

    return NextResponse.json({
      ok: true,
      holdersSnapshotted: holderCount,
      eligibleHolders: eligibleHolders.length,
      excludedHolders: excludedHolders.length,
      claimCount,
      eligibleSupply: eligibleSupply.toString(),
      claimPool,
      settledDistributionAmount,
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

  if (action === 'claims_export') {
    const { epochId } = body
    if (!epochId) return NextResponse.json({ error: 'epochId required' }, { status: 400 })

    const epoch = await prisma.distributionEpoch.findUnique({ where: { id: epochId } })
    if (!epoch) return NextResponse.json({ error: 'Epoch not found' }, { status: 404 })

    const [snapshots, claims] = await Promise.all([
      prisma.holderSnapshot.findMany({
        where: { epochId },
        orderBy: [{ excluded: 'asc' }, { claimAmount: 'desc' }],
      }),
      prisma.claim.findMany({
        where: { epochId },
        select: { walletAddress: true, status: true, txHash: true },
      }),
    ])

    const claimMap = new Map(claims.map((c) => [c.walletAddress, c]))
    const dateStr = epoch.epochDate.toISOString().slice(0, 10)

    const csvRows = [
      ['wallet', 'tokenBalance', 'eligibleBalance', 'claimAmount', 'excluded', 'status', 'txSignature'].join(','),
      ...snapshots.map((s) => {
        const claim = claimMap.get(s.walletAddress)
        return [
          s.walletAddress,
          s.tokenBalance.toString(),
          (s.eligibleBalance ?? '0').toString(),
          s.claimAmount.toString(),
          s.excluded ? 'true' : 'false',
          claim?.status ?? 'NO_CLAIM',
          claim?.txHash ?? '',
        ].join(',')
      }),
    ].join('\n')

    return new Response(csvRows, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="epoch-${dateStr}-claims.csv"`,
      },
    })
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
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Mock snapshots are disabled in production.' }, { status: 403 })
    }
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

  if (action === 'full_prelaunch_reset') {
    const { confirm } = body
    if (confirm !== 'RESET BILLIONBOARD') {
      return NextResponse.json({ error: 'Type RESET BILLIONBOARD to confirm' }, { status: 400 })
    }

    // Delete in FK-safe order: children first, parents last.
    // Never touches: User, Setting, ExcludedWallet, AdvertiserWallet records.
    const [
      settlements,
      billingItems,
      revenueEvents,
      claims,
      holderSnapshots,
      epochs,
      billingRuns,
      rentals,
      creatives,
      topups,
      processedTxs,
    ] = await prisma.$transaction([
      prisma.revenueSettlement.deleteMany({}),
      prisma.billingItem.deleteMany({}),
      prisma.revenueEvent.deleteMany({}),
      prisma.claim.deleteMany({}),
      prisma.holderSnapshot.deleteMany({}),
      prisma.distributionEpoch.deleteMany({}),
      prisma.dailyBillingRun.deleteMany({}),
      prisma.adRental.deleteMany({}),
      prisma.adCreative.deleteMany({}),
      prisma.topup.deleteMany({}),
      prisma.processedTransaction.deleteMany({}),
    ])

    // Zero all advertiser balances (keep the wallet records so users can log back in)
    const usersReset = await prisma.advertiserWallet.updateMany({
      data: { usdcBalance: 0 },
    })

    return NextResponse.json({
      ok: true,
      summary: {
        settlements: settlements.count,
        billingItems: billingItems.count,
        revenueEvents: revenueEvents.count,
        claims: claims.count,
        holderSnapshots: holderSnapshots.count,
        epochs: epochs.count,
        billingRuns: billingRuns.count,
        rentals: rentals.count,
        creatives: creatives.count,
        topups: topups.count,
        processedTxs: processedTxs.count,
        usersBalancesZeroed: usersReset.count,
      },
    })
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

  if (action === 'retry_all_retryable') {
    const now = new Date()
    const pending = await prisma.revenueSettlement.findMany({
      where: {
        retryable: true,
        nextRetryAt: { lte: now },
        settlementStatus: { not: 'SETTLED' },
      },
      select: { id: true, revenueEventId: true, retryCount: true, settlementStatus: true },
      orderBy: { nextRetryAt: 'asc' },
      take: 50,
    })

    const results: Array<{ settlementId: string; revenueEventId: string; ok: boolean; status: string; error?: string }> = []
    for (const record of pending) {
      try {
        const result = await settleRevenueEvent(record.revenueEventId)
        results.push({ settlementId: record.id, revenueEventId: record.revenueEventId, ok: result.ok, status: result.status, error: result.error })
      } catch (err) {
        results.push({ settlementId: record.id, revenueEventId: record.revenueEventId, ok: false, status: 'ERROR', error: err instanceof Error ? err.message : String(err) })
      }
    }

    const succeeded = results.filter(r => r.ok).length
    const failed = results.filter(r => !r.ok).length
    return NextResponse.json({ ok: true, retried: results.length, succeeded, failed, results })
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

  // ── Accounting repair tools ─────────────────────────────────────────────────

  if (action === 'set_wallet_balance') {
    // Manually set an advertiser's internal balance (requires reason, creates audit event)
    const { userId, newBalance, reason } = body
    if (!userId || newBalance === undefined || !reason?.trim()) {
      return NextResponse.json({ error: 'userId, newBalance, and reason required' }, { status: 400 })
    }
    const newBalNum = parseFloat(newBalance)
    if (isNaN(newBalNum) || newBalNum < 0) {
      return NextResponse.json({ error: 'newBalance must be a non-negative number' }, { status: 400 })
    }

    const existing = await prisma.advertiserWallet.findUnique({ where: { userId }, select: { usdcBalance: true } })
    const oldBalance = existing ? Number(existing.usdcBalance) : 0
    const delta = newBalNum - oldBalance

    await prisma.$transaction(async (tx) => {
      await tx.advertiserWallet.upsert({
        where: { userId },
        create: { userId, usdcBalance: newBalNum },
        update: { usdcBalance: newBalNum },
      })
      await tx.revenueEvent.create({
        data: {
          type: 'MANUAL_ADJUSTMENT',
          source: 'admin_balance_set',
          amount: Math.abs(delta),
          currency: 'USDC',
          userId,
          metadata: { oldBalance, newBalance: newBalNum, delta, reason },
        },
      })
    })

    return NextResponse.json({ ok: true, oldBalance, newBalance: newBalNum, delta })
  }

  if (action === 'recalculate_balance_from_topups') {
    // Recalculate user balance: confirmed real topups - total billed ad charges
    const { userId } = body
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const [realTopups, billedRevenue, mockTopups] = await Promise.all([
      prisma.topup.aggregate({
        where: { userId, status: 'CONFIRMED', method: 'usdc_solana', txSignature: { not: null } },
        _sum: { actualAmount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { userId, type: 'AD_RENT_REVENUE' },
        _sum: { amount: true },
      }),
      prisma.topup.aggregate({
        where: { userId, status: 'CONFIRMED', method: 'mock' },
        _sum: { actualAmount: true },
      }),
    ])

    const realTopupTotal = Number(realTopups._sum.actualAmount ?? 0)
    const billedTotal = Number(billedRevenue._sum.amount ?? 0)
    const mockTotal = Number(mockTopups._sum.actualAmount ?? 0)
    const calculatedBalance = Math.max(0, realTopupTotal - billedTotal)

    return NextResponse.json({
      ok: true,
      userId,
      realTopupTotal,
      mockTopupTotal: mockTotal,
      billedTotal,
      calculatedBalance,
      note: 'Preview only — use set_wallet_balance to apply. Calculation: real topups - billed ad charges.',
    })
  }

  if (action === 'backfill_activation_charges') {
    // For ACTIVE rentals missing an activation revenue event, create it and deduct balance.
    // Idempotent: checks for existing activation event before creating.
    const now = new Date()
    const [freeEnabled, tilePrice] = await Promise.all([isFreeRentalEnabled(), getTilePrice()])

    if (freeEnabled) {
      return NextResponse.json({ ok: true, backfilled: 0, skipped: 0, note: 'Free mode — no charges needed' })
    }

    // Group ACTIVE rentals by creative (order) to match the activation logic
    const activeRentals = await prisma.adRental.findMany({
      where: { status: 'ACTIVE' },
      include: { user: { include: { advertiserWallet: true } } },
      orderBy: { startDate: 'asc' },
    })

    // Find rentals without an activation revenue event
    // An activation event has source='activation' or source='admin_approval'
    const allActivationEvents = await prisma.revenueEvent.findMany({
      where: { type: 'AD_RENT_REVENUE', source: { in: ['activation', 'admin_approval', 'ACTIVATION_BACKFILL'] } },
      select: { userId: true, metadata: true, createdAt: true },
    })

    // Group active rentals by userId+creativeId to identify orders
    type OrderGroup = { userId: string; rentalIds: string[]; creativeId: string | null; startDate: Date | null; wallet: { usdcBalance: number } | null }
    const orderMap = new Map<string, OrderGroup>()
    for (const r of activeRentals) {
      const key = `${r.userId}::${r.creativeId ?? r.id}`
      if (!orderMap.has(key)) {
        orderMap.set(key, {
          userId: r.userId,
          rentalIds: [],
          creativeId: r.creativeId,
          startDate: r.startDate,
          wallet: r.user.advertiserWallet ? { usdcBalance: Number(r.user.advertiserWallet.usdcBalance) } : null,
        })
      }
      orderMap.get(key)!.rentalIds.push(r.id)
    }

    // Find which orders already have activation revenue events
    // We match by userId and check event metadata.rentalIds or metadata.creativeId
    const alreadyChargedCreatives = new Set<string>()
    for (const ev of allActivationEvents) {
      const meta = ev.metadata as Record<string, unknown> | null
      if (meta?.creativeId && typeof meta.creativeId === 'string') {
        alreadyChargedCreatives.add(`${ev.userId}::${meta.creativeId}`)
      }
      if (Array.isArray(meta?.rentalIds)) {
        for (const rid of meta.rentalIds as string[]) {
          alreadyChargedCreatives.add(`${ev.userId}::rental::${rid}`)
        }
      }
    }

    let backfilled = 0
    let skippedInsufficient = 0
    let skippedAlreadyCharged = 0
    let suspended = 0

    const epoch = await getOrCreateEpoch(utcDayStart(now))

    for (const [key, order] of orderMap) {
      const tileCount = order.rentalIds.length
      const cost = tileCount * tilePrice

      // Check if already charged
      const alreadyCharged =
        (order.creativeId && alreadyChargedCreatives.has(`${order.userId}::${order.creativeId}`)) ||
        order.rentalIds.some((rid) => alreadyChargedCreatives.has(`${order.userId}::rental::${rid}`))

      if (alreadyCharged) {
        skippedAlreadyCharged++
        continue
      }

      const walletBalance = order.wallet?.usdcBalance ?? 0
      if (walletBalance < cost) {
        // Suspend the rentals
        await prisma.adRental.updateMany({
          where: { id: { in: order.rentalIds } },
          data: { status: 'SUSPENDED', endDate: now },
        })
        suspended += tileCount
        continue
      }

      // Deduct balance and create revenue event
      await prisma.$transaction(async (tx) => {
        await tx.advertiserWallet.update({
          where: { userId: order.userId },
          data: { usdcBalance: { decrement: cost } },
        })
        await tx.revenueEvent.create({
          data: {
            type: 'AD_RENT_REVENUE',
            source: 'ACTIVATION_BACKFILL',
            amount: cost,
            currency: 'USDC',
            epochId: epoch.id,
            userId: order.userId,
            metadata: {
              tileCount,
              rentalIds: order.rentalIds,
              creativeId: order.creativeId,
              dailyRate: tilePrice,
              backfilledAt: now.toISOString(),
              originalStartDate: order.startDate?.toISOString() ?? null,
            },
          },
        })
        // Update nextBillingAt if not set
        await tx.adRental.updateMany({
          where: { id: { in: order.rentalIds }, nextBillingAt: null },
          data: { lastBilledAt: now, nextBillingAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
        })
      })
      backfilled += tileCount
    }

    return NextResponse.json({
      ok: true,
      backfilled,
      skippedAlreadyCharged,
      skippedInsufficient,
      suspended,
      note: `Backfilled ${backfilled} tiles. ${suspended} suspended (insufficient balance). ${skippedAlreadyCharged} already charged.`,
    })
  }

  if (action === 'audit_settlement_coverage') {
    // Ensure every AD_RENT_REVENUE and TRADING_FEE_REVENUE event has a settlement row
    const revenueEvents = await prisma.revenueEvent.findMany({
      where: { type: { in: ['AD_RENT_REVENUE', 'TRADING_FEE_REVENUE'] } },
      include: { settlement: { select: { id: true } } },
    })

    const feePercentStr = await getSetting('management_fee_percent')
    const feePercent = parseFloat(feePercentStr)

    let created = 0
    const sourceWallet = env.topupWallet ?? ''
    const revenueWallet = env.revenueWallet ?? ''
    const treasuryWallet = env.treasuryWallet ?? ''
    const distributionWallet = env.distributionWallet ?? ''

    for (const ev of revenueEvents) {
      if (ev.settlement) continue
      const amount = Number(ev.amount)
      const treasuryAmount = (amount * feePercent) / 100
      const distributionAmount = amount - treasuryAmount

      const src = ev.type === 'TRADING_FEE_REVENUE' ? (env.feeCreatorWallet ?? sourceWallet) : sourceWallet

      await prisma.revenueSettlement.create({
        data: {
          revenueEventId: ev.id,
          sourceWallet: src,
          revenueWallet,
          treasuryWallet,
          distributionWallet,
          amount,
          treasuryAmount,
          distributionAmount,
          settlementStatus: 'UNSETTLED',
        },
      })
      created++
    }

    return NextResponse.json({
      ok: true,
      totalEvents: revenueEvents.length,
      alreadyHadSettlement: revenueEvents.length - created,
      created,
      note: `Created ${created} missing settlement rows. Use Settlements tab to retry.`,
    })
  }

  if (action === 'test_sentry') {
    captureAppError(new Error('BillionBoard Sentry test event'), {
      route: 'admin_test',
      test: true,
    })
    return NextResponse.json({ ok: true, message: 'Test event sent to Sentry (no-op if SENTRY_DSN is not set).' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
