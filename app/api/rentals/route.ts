import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { TOTAL_TILES, isRectangularSelection } from '@/lib/types'
import { getTilePrice, isFreeRentalEnabled, isAutoApproveEnabled } from '@/lib/settings'

// Strips any existing protocol and ensures https:// prefix.
// Handles: brainrush.gg → https://brainrush.gg, http://… → https://…
function normalizeDestUrl(raw: string): string {
  const stripped = raw.trim().replace(/^https?:\/\//i, '').replace(/^\/\//, '')
  return `https://${stripped}`
}

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

  const { tileIds, imageUrl, destUrl, altText, displayMode: rawDisplayMode } = await req.json()
  const displayMode = rawDisplayMode === 'STRETCH' ? 'STRETCH' : 'REPEAT'

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
  // Deduplicate before further validation (isRectangularSelection also deduplicates internally)
  const uniqueTileIds: number[] = Array.from(new Set<number>(tileIds))
  if (!destUrl || !imageUrl) {
    return NextResponse.json({ error: 'imageUrl and destUrl required' }, { status: 400 })
  }
  if (displayMode === 'STRETCH' && !isRectangularSelection(uniqueTileIds)) {
    return NextResponse.json(
      { error: 'Stretch mode requires a rectangular block of connected tiles.' },
      { status: 400 }
    )
  }

  // Normalize destUrl: strip any existing protocol, then prepend https://
  const normalizedDestUrl = normalizeDestUrl(destUrl)
  try {
    const parsed = new URL(normalizedDestUrl)
    if (!parsed.hostname.includes('.')) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Please enter a valid website URL.' }, { status: 400 })
  }
  try {
    new URL(imageUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })
  }

  // Check tiles are available
  const occupied = await prisma.adRental.findMany({
    where: {
      tileId: { in: uniqueTileIds },
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
  const [tilePrice, freeEnabled, autoApprove] = await Promise.all([getTilePrice(), isFreeRentalEnabled(), isAutoApproveEnabled()])

  const dailyRate = freeEnabled ? 0 : tilePrice

  if (!freeEnabled) {
    // Check sufficient balance (1 day reserve); use integer cents to avoid float precision errors
    const requiredCents = Math.round(uniqueTileIds.length * tilePrice * 100)
    const wallet = await prisma.advertiserWallet.findUnique({
      where: { userId: session.userId },
    })
    const walletCents = Math.round(Number(wallet?.usdcBalance ?? 0) * 100)
    if (!wallet || walletCents < requiredCents) {
      return NextResponse.json(
        { error: `Insufficient balance. Need $${(requiredCents / 100).toFixed(2)} USDC` },
        { status: 402 }
      )
    }
  }

  // Create creative + rentals in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const creative = await tx.adCreative.create({
      data: { userId: session.userId, imageUrl, destUrl: normalizedDestUrl, altText: altText ?? null, displayMode },
    })
    const rentals = await Promise.all(
      uniqueTileIds.map((tileId: number) =>
        tx.adRental.create({
          data: {
            userId: session.userId,
            tileId,
            creativeId: creative.id,
            status: autoApprove ? 'ACTIVE' : 'PENDING_APPROVAL',
            startDate: autoApprove ? new Date() : null,
            dailyRate,
          },
        })
      )
    )
    return { creative, rentals }
  })

  return NextResponse.json({ ok: true, rentalCount: result.rentals.length, autoApproved: autoApprove }, { status: 201 })
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
