import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { TileInfoMap } from '@/lib/types'

export async function GET() {
  const rentals = await prisma.adRental.findMany({
    where: { status: { in: ['PENDING_APPROVAL', 'ACTIVE'] } },
    select: {
      tileId: true,
      status: true,
      creativeId: true,
      creative: { select: { imageUrl: true, destUrl: true, altText: true, displayMode: true } },
      user: { select: { email: true } },
    },
  })

  const tiles: TileInfoMap = {}
  for (const r of rentals) {
    tiles[r.tileId] = {
      status: r.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
      creativeId: r.creativeId ?? undefined,
      imageUrl: r.creative?.imageUrl ?? undefined,
      destUrl: r.creative?.destUrl ?? undefined,
      altText: r.creative?.altText ?? undefined,
      advertiserEmail: r.user?.email ?? undefined,
      displayMode: (r.creative?.displayMode ?? 'REPEAT') as 'REPEAT' | 'STRETCH',
    }
  }

  return NextResponse.json({ tiles })
}
