import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { TileStatusMap } from '@/lib/types'

// Returns sparse map of occupied tiles { tileId: status }
export async function GET() {
  const rentals = await prisma.adRental.findMany({
    where: {
      status: { in: ['PENDING_APPROVAL', 'ACTIVE'] },
    },
    select: {
      tileId: true,
      status: true,
      creative: {
        select: { imageUrl: true, destUrl: true, altText: true },
      },
    },
  })

  const tiles: TileStatusMap = {}
  for (const r of rentals) {
    tiles[r.tileId] = r.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING'
  }

  return NextResponse.json({ tiles })
}
