import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { tileIdToCoords } from '@/lib/types'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const tileId = parseInt(id, 10)
  if (isNaN(tileId) || tileId < 0 || tileId >= 100000) {
    return NextResponse.json({ error: 'Invalid tile id' }, { status: 400 })
  }

  const { col, row } = tileIdToCoords(tileId)

  const rental = await prisma.adRental.findFirst({
    where: {
      tileId,
      status: { in: ['PENDING_APPROVAL', 'ACTIVE'] },
    },
    include: {
      creative: { select: { imageUrl: true, destUrl: true, altText: true } },
      user: { select: { email: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    tileId,
    col,
    row,
    status: rental
      ? rental.status === 'ACTIVE'
        ? 'ACTIVE'
        : 'PENDING'
      : 'AVAILABLE',
    rental: rental
      ? {
          id: rental.id,
          destUrl: rental.creative?.destUrl ?? null,
          imageUrl: rental.creative?.imageUrl ?? null,
          altText: rental.creative?.altText ?? null,
          dailyRate: rental.dailyRate,
          startDate: rental.startDate,
        }
      : null,
  })
}
