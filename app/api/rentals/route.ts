import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { TOTAL_TILES } from '@/lib/types'
import { getTilePrice, isFreeRentalEnabled } from '@/lib/settings'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rentals = await prisma.adRental.findMany({
    where: { userId: session.userId },
    include: { creative: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ rentals })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tileIds, imageUrl, destUrl, altText } = await req.json()

  if (!Array.isArray(tileIds) || tileIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one tile' }, { status: 400 })
  }
  if (tileIds.length > 500) {
    return NextResponse.json({ error: 'Max 500 tiles per submission' }, { status: 400 })
  }
  for (const id of tileIds) {
    if (typeof id !== 'number' || id < 0 || id >= TOTAL_TILES) {
      return NextResponse.json({ error: `Invalid tileId: ${id}` }, { status: 400 })
    }
  }
  if (!destUrl || !imageUrl) {
    return NextResponse.json({ error: 'imageUrl and destUrl required' }, { status: 400 })
  }

  try {
    new URL(destUrl)
    new URL(imageUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  // Check tiles are available
  const occupied = await prisma.adRental.findMany({
    where: {
      tileId: { in: tileIds },
      status: { in: ['PENDING_APPROVAL', 'ACTIVE'] },
    },
    select: { tileId: true },
  })
  if (occupied.length > 0) {
    return NextResponse.json(
      { error: 'Some tiles are already occupied', occupied: occupied.map((r) => r.tileId) },
      { status: 409 }
    )
  }

  // Fetch pricing settings
  const [tilePrice, freeEnabled] = await Promise.all([getTilePrice(), isFreeRentalEnabled()])

  const dailyRate = freeEnabled ? 0 : tilePrice

  if (!freeEnabled) {
    // Check sufficient balance (1 day reserve)
    const requiredBalance = tileIds.length * tilePrice
    const wallet = await prisma.advertiserWallet.findUnique({
      where: { userId: session.userId },
    })
    if (!wallet || Number(wallet.usdcBalance) < requiredBalance) {
      return NextResponse.json(
        { error: `Insufficient balance. Need $${requiredBalance.toFixed(2)} USDC` },
        { status: 402 }
      )
    }
  }

  // Create creative + rentals in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const creative = await tx.adCreative.create({
      data: { userId: session.userId, imageUrl, destUrl, altText: altText ?? null },
    })
    const rentals = await Promise.all(
      tileIds.map((tileId: number) =>
        tx.adRental.create({
          data: {
            userId: session.userId,
            tileId,
            creativeId: creative.id,
            status: 'PENDING_APPROVAL',
            dailyRate,
          },
        })
      )
    )
    return { creative, rentals }
  })

  return NextResponse.json({ ok: true, rentalCount: result.rentals.length }, { status: 201 })
}

export async function DELETE(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rentalId } = await req.json()
  const rental = await prisma.adRental.findUnique({ where: { id: rentalId } })

  if (!rental || rental.userId !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (rental.status === 'EXPIRED' || rental.status === 'REJECTED') {
    return NextResponse.json({ error: 'Rental already closed' }, { status: 400 })
  }

  await prisma.adRental.update({
    where: { id: rentalId },
    data: { status: 'EXPIRED', endDate: new Date() },
  })

  return NextResponse.json({ ok: true })
}
