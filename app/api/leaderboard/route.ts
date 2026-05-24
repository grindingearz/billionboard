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

  const [campaigns, clickCounts, click24hCounts] = await Promise.all([
    prisma.adCreative.findMany({
      where: { campaignStatus: 'ACTIVE' },
      select: {
        id: true,
        campaignName: true,
        destUrl: true,
        imageUrl: true,
        durationType: true,
        campaignStartAt: true,
        campaignEndAt: true,
        adRentals: {
          where: { status: 'ACTIVE' },
          select: { id: true },
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

  const entries = campaigns.map((c) => {
    const activeTiles = c.adRentals.length
    const boardSharePercent = (activeTiles / 100000) * 100
    const endAt = c.campaignEndAt ? new Date(c.campaignEndAt) : null
    const daysRemaining = endAt
      ? Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / 86400000))
      : 0
    const billboardPower = activeTiles * Math.max(daysRemaining, 0)
    const totalClicks = clickMap.get(c.id) ?? 0
    const clicks24h = click24hMap.get(c.id) ?? 0

    return {
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
      campaignStartAt: c.campaignStartAt?.toISOString() ?? null,
      campaignEndAt: c.campaignEndAt?.toISOString() ?? null,
    }
  })

  const totalActiveTiles = entries.reduce((s, e) => s + e.activeTiles, 0)
  const totalClicks = entries.reduce((s, e) => s + e.totalClicks, 0)
  const totalClicks24h = entries.reduce((s, e) => s + e.clicks24h, 0)

  const top = (arr: typeof entries) => arr.slice(0, 50)

  const biggestTerritory = top([...entries].sort((a, b) => b.activeTiles - a.activeTiles))
  const billboardPower = top([...entries].sort((a, b) => b.billboardPower - a.billboardPower))
  const todaysTakeover = top([...entries].sort((a, b) => b.boardSharePercent - a.boardSharePercent))
  const mostClicked = top([...entries].sort((a, b) => b.totalClicks - a.totalClicks))
  const newCampaigns = top(
    [...entries]
      .filter((e) => e.campaignStartAt != null)
      .sort((a, b) => new Date(b.campaignStartAt!).getTime() - new Date(a.campaignStartAt!).getTime())
  )
  const expiringSoon = top(
    [...entries]
      .filter((e) => e.campaignEndAt != null && e.daysRemaining > 0)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
  )

  return NextResponse.json({
    stats: {
      totalActiveCampaigns: entries.length,
      totalActiveTiles,
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
