import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// Backfills campaignStartAt on legacy per-day ads so they appear in the leaderboard.
// Safe: does not touch campaignStatus, campaignEndAt, or billing fields.
// Does not create revenue events or charge users.
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find legacy creatives: have ACTIVE rentals but missing campaignStartAt
  const legacyCreatives = await prisma.adCreative.findMany({
    where: {
      campaignStartAt: null,
      adRentals: { some: { status: 'ACTIVE' } },
    },
    select: {
      id: true,
      createdAt: true,
      adRentals: {
        where: { status: 'ACTIVE' },
        select: { startDate: true },
        orderBy: { startDate: 'asc' },
        take: 1,
      },
    },
  })

  const results: { id: string; campaignStartAt: string }[] = []

  for (const c of legacyCreatives) {
    const startAt =
      c.adRentals[0]?.startDate ?? c.createdAt

    await prisma.adCreative.update({
      where: { id: c.id },
      data: { campaignStartAt: startAt },
    })

    results.push({ id: c.id, campaignStartAt: startAt.toISOString() })
  }

  console.log(`[backfill-leaderboard] updated ${results.length} legacy creatives`)

  return NextResponse.json({
    ok: true,
    updated: results.length,
    creatives: results,
  })
}

// GET returns a dry-run preview without writing anything
export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const legacyCreatives = await prisma.adCreative.findMany({
    where: {
      campaignStartAt: null,
      adRentals: { some: { status: 'ACTIVE' } },
    },
    select: {
      id: true,
      destUrl: true,
      createdAt: true,
      adRentals: {
        where: { status: 'ACTIVE' },
        select: { startDate: true, _count: true },
        orderBy: { startDate: 'asc' },
      },
    },
  })

  return NextResponse.json({
    pendingBackfill: legacyCreatives.length,
    creatives: legacyCreatives.map((c) => ({
      id: c.id,
      // domain only — no wallet addresses
      domain: (() => {
        try { return new URL(c.destUrl).hostname } catch { return c.destUrl }
      })(),
      activeTiles: c.adRentals.length,
      inferredStartAt: (c.adRentals[0]?.startDate ?? c.createdAt).toISOString(),
    })),
  })
}
