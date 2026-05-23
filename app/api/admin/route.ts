import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'

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
    const rentals = await prisma.adRental.findMany({
      where: { status: 'ACTIVE' },
      include: {
        creative: true,
        user: { select: { email: true, walletAddress: true } },
      },
      orderBy: { startDate: 'desc' },
    })
    return NextResponse.json({ rentals })
  }

  if (view === 'epochs') {
    const epochs = await prisma.distributionEpoch.findMany({
      orderBy: { epochDate: 'desc' },
      take: 10,
    })
    return NextResponse.json({ epochs })
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
    await prisma.adRental.updateMany({
      where: { creativeId, status: 'PENDING_APPROVAL' },
      data: { status: 'ACTIVE', startDate: new Date() },
    })
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
    const result = await prisma.adRental.updateMany({
      where: { status: 'PENDING_APPROVAL' },
      data: { status: 'ACTIVE', startDate: new Date() },
    })
    return NextResponse.json({ ok: true, count: result.count })
  }

  if (action === 'reject_all_orders') {
    const result = await prisma.adRental.updateMany({
      where: { status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED' },
    })
    return NextResponse.json({ ok: true, count: result.count })
  }

  if (action === 'expire') {
    const { rentalId } = body
    await prisma.adRental.update({
      where: { id: rentalId },
      data: { status: 'EXPIRED', endDate: new Date() },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'publish_epoch') {
    const { epochId } = body
    await prisma.distributionEpoch.update({
      where: { id: epochId },
      data: { status: 'PUBLISHED' },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'create_epoch') {
    const { totalPool, billingRunId } = body
    const epoch = await prisma.distributionEpoch.create({
      data: {
        epochDate: new Date(),
        totalPool: parseFloat(totalPool),
        billingRunId: billingRunId ?? null,
        status: 'PENDING',
      },
    })
    return NextResponse.json({ ok: true, epoch })
  }

  if (action === 'snapshot_epoch') {
    // TODO: replace with real $BOARD token holder indexing from Solana RPC
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
        data: { status: 'SNAPSHOT_TAKEN', snapshotDate: new Date() },
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

  if (action === 'assign_topup') {
    // Manually assign an unmatched ProcessedTransaction to a user's balance
    const { txId, userId } = body
    const tx = await prisma.processedTransaction.findUnique({ where: { id: txId } })
    if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    if (tx.topupId) return NextResponse.json({ error: 'Already assigned' }, { status: 409 })

    const topup = await prisma.topup.create({
      data: {
        userId,
        amount: tx.amountUsdc,
        method: 'usdc_solana',
        status: 'CONFIRMED',
        txSignature: tx.signature,
        actualAmount: tx.amountUsdc,
        advertiserWallet: tx.senderWallet,
        depositWallet: tx.receiverWallet,
        confirmedAt: tx.processedAt,
      },
    })
    await prisma.$transaction([
      prisma.processedTransaction.update({
        where: { id: txId },
        data: { topupId: topup.id },
      }),
      prisma.advertiserWallet.upsert({
        where: { userId },
        create: { userId, usdcBalance: tx.amountUsdc },
        update: { usdcBalance: { increment: tx.amountUsdc } },
      }),
    ])
    return NextResponse.json({ ok: true })
  }

  if (action === 'expire_topup') {
    const { topupId } = body
    await prisma.topup.update({
      where: { id: topupId },
      data: { status: 'EXPIRED' },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reconcile') {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/cron/reconcile-usdc-topups`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
        },
      }
    )
    const d = await res.json()
    return NextResponse.json(d)
  }

  if (action === 'reset_test_account') {
    const { walletAddress } = body
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 })

    const user = await prisma.user.findFirst({ where: { walletAddress }, select: { id: true } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    await prisma.$transaction([
      // Zero the balance
      prisma.advertiserWallet.upsert({
        where: { userId: user.id },
        update: { usdcBalance: 0 },
        create: { userId: user.id, usdcBalance: 0 },
      }),
      // Expire all pending real topups
      prisma.topup.updateMany({
        where: { userId: user.id, method: 'usdc_solana', status: 'PENDING' },
        data: { status: 'EXPIRED' },
      }),
      // Reject non-terminal mock topups (CONFIRMED mock topups stay as history)
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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
