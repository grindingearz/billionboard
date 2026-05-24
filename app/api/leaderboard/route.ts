import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function getDomain(url: string): string {
  try { return new URL(url).hostname } catch { return url.replace(/^https?:\/\//, '').split('/')[0] }
}

function getDisplayName(campaignName: string | null, destUrl: string, id: string): string {
  if (campaignName?.trim()) return campaignName.trim()
  const domain = getDomain(destUrl)
  if (domain) return domain
  return id.slice(0, 8)
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // Count all active board tiles for UI fallback signal
  const allActiveTilesCount = await prisma.adRental.count({ where: { status: 'ACTIVE' } })

  // Include legacy ads (campaignStatus=null) AND campaign ads (campaignStatus='ACTIVE').
  // Exclude only explicitly expired/rejected creatives.
  const [rawCampaigns, clickCounts, click24hCounts] = await Promise.all([
    prisma.adCreative.findMany({
      where: {
        OR: [{ campaignStatus: null }, { campaignStatus: 'ACTIVE' }],
        adRentals: { some: { status: 'ACTIVE' } },
      },
      select: {
        id: true,
        campaignName: true,
        destUrl: true,
        imageUrl: true,
        durationType: true,
        campaignStartAt: true,
        campaignEndAt: true,
        createdAt: true,
        adRentals: {
          where: { status: 'ACTIVE' },
          select: { id: true, startDate: true, nextBillingAt: true, dailyRate: true },
        },
      },
    }),
    prisma.clickEvent.groupBy({
      by: ['creativeId'],
      _count: { id: true },
    }),
    prisma.clickEvent.groupBy({
      by: ['creativeId'],
      where: { createdAt: { gte: since24h } },
      _count: { id: true },
    }),
  ])

  const clickMap = new Map(clickCounts.map((c) => [c.creativeId, c._count.id]))
  const click24hMap = new Map(click24hCounts.map((c) => [c.creativeId, c._count.id]))

  // Debug logging (server-side only)
  console.log(`[leaderboard] allActiveTiles=${allActiveTilesCount} rawCampaigns=${rawCampaigns.length}`)

  const excluded: { id: string; reason: string }[] = []

  const entries = rawCampaigns.flatMap((c) => {
    const activeTiles = c.adRentals.length
    if (activeTiles === 0) {
      excluded.push({ id: c.id, reason: 'zero_tiles' })
      return []
    }

    // Resolve startAt with fallback chain
    const rentalStartDates = c.adRentals.map((r) => r.startDate).filter(Boolean) as Date[]
    const earliestRentalStart = rentalStartDates.length > 0
      ? new Date(Math.min(...rentalStartDates.map((d) => d.getTime())))
      : null
    const startAt = c.campaignStartAt ?? earliestRentalStart ?? c.createdAt

    // Resolve endAt with fallback chain
    // For legacy per-day ads, nextBillingAt represents the "paid-until" boundary
    const rentalNextBillings = c.adRentals.map((r) => r.nextBillingAt).filter(Boolean) as Date[]
    const latestNextBilling = rentalNextBillings.length > 0
      ? new Date(Math.max(...rentalNextBillings.map((d) => d.getTime())))
      : null
    const endAt = c.campaignEndAt ?? latestNextBilling ?? new Date(startAt.getTime() + 24 * 60 * 60 * 1000)

    const boardSharePercent = (activeTiles / 100000) * 100
    const daysRemaining = Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / 86400000))
    const billboardPower = activeTiles * Math.max(daysRemaining, 0)
    const totalClicks = clickMap.get(c.id) ?? 0
    const clicks24h = click24hMap.get(c.id) ?? 0

    return [{
      creativeId: c.id,
      displayName: getDisplayName(c.campaignName, c.destUrl, c.id),
      destUrl: c.destUrl,
      imageUrl: c.imageUrl,
      durationType: c.durationType ?? null,
      activeTiles,
      boardSharePercent: Math.round(boardSharePercent * 10000) / 10000,
      daysRemaining,
      billboardPower,
      totalClicks,
      clicks24h,
      campaignStartAt: startAt.toISOString(),
      campaignEndAt: endAt.toISOString(),
    }]
  })

  console.log(`[leaderboard] eligible=${entries.length} excluded=${JSON.stringify(excluded)}`)

  const totalActiveTiles = entries.reduce((s, e) => s + e.activeTiles, 0)
  const totalClicks = entries.reduce((s, e) => s + e.totalClicks, 0)
  const totalClicks24h = entries.reduce((s, e) => s + e.clicks24h, 0)

  const top = (arr: typeof entries) => arr.slice(0, 50)

  const biggestTerritory = top([...entries].sort((a, b) => b.activeTiles - a.activeTiles))
  const billboardPower = top([...entries].sort((a, b) => b.billboardPower - a.billboardPower))
  const todaysTakeover = top([...entries].sort((a, b) => b.boardSharePercent - a.boardSharePercent))
  const mostClicked = top([...entries].sort((a, b) => b.totalClicks - a.totalClicks))
  const newCampaigns = top(
    [...entries].sort((a, b) => new Date(b.campaignStartAt).getTime() - new Date(a.campaignStartAt).getTime())
  )
  const expiringSoon = top(
    [...entries]
      .filter((e) => e.daysRemaining > 0)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
  )

  return NextResponse.json({
    stats: {
      totalActiveCampaigns: entries.length,
      totalActiveTiles,
      totalBoardActiveTiles: allActiveTilesCount,
      totalClicks,
      totalClicks24h,
    },
    tabs: {
      biggestTerritory,
      billboardPower,
      todaysTakeover,
      mostClicked,
      newCampaigns,
      expiringSoon,
    },
  })
}
