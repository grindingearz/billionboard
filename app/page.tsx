import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import HomeBillboard from '@/components/HomeBillboard'
import { TOTAL_TILES } from '@/lib/types'
import type { TileInfoMap } from '@/lib/types'
import { getAllSettings, getCampaignPricing } from '@/lib/settings'

export const dynamic = 'force-dynamic'

async function getPageData() {
  const now = new Date()
  try {
    const [activeRentals, pendingTiles] = await Promise.all([
      prisma.adRental.findMany({
        where: { status: 'ACTIVE' },
        select: {
          tileId: true,
          creativeId: true,
          nextBillingAt: true,
          creative: {
            select: {
              imageUrl: true,
              destUrl: true,
              altText: true,
              displayMode: true,
              campaignType: true,
              durationType: true,
              campaignStartAt: true,
              campaignEndAt: true,
            },
          },
        },
      }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
    ])

    const tiles: TileInfoMap = {}
    for (const r of activeRentals) {
      const campaignType = r.creative?.campaignType ?? 'PAID'

      // PAID campaigns: enforce time validity so overdue ads never render on the board
      if (campaignType !== 'ADMIN_FREE') {
        if (r.creative?.durationType) {
          // Duration campaign: must be within [campaignStartAt, campaignEndAt)
          const startOk = !r.creative.campaignStartAt || r.creative.campaignStartAt.getTime() <= now.getTime()
          const endOk = r.creative.campaignEndAt != null && r.creative.campaignEndAt.getTime() > now.getTime()
          if (!startOk || !endOk) continue
        } else {
          // Legacy per-day: nextBillingAt must exist and be in the future
          if (r.nextBillingAt == null || r.nextBillingAt.getTime() <= now.getTime()) continue
        }
      }

      tiles[r.tileId] = {
        status: 'ACTIVE',
        creativeId: r.creativeId ?? undefined,
        imageUrl: r.creative?.imageUrl ?? undefined,
        destUrl: r.creative?.destUrl ?? undefined,
        altText: r.creative?.altText ?? undefined,
        displayMode: (r.creative?.displayMode ?? 'REPEAT') as 'REPEAT' | 'STRETCH',
        campaignType: campaignType as 'PAID' | 'ADMIN_FREE',
      }
    }

    const activeTiles = Object.keys(tiles).length
    const paidActiveTiles = Object.values(tiles).filter(t => t.campaignType !== 'ADMIN_FREE').length
    return {
      tiles,
      stats: {
        activeTiles,
        paidActiveTiles,
        pendingTiles,
        availableTiles: TOTAL_TILES - activeTiles - pendingTiles,
      },
    }
  } catch {
    return {
      tiles: {},
      stats: { activeTiles: 0, paidActiveTiles: 0, pendingTiles: 0, availableTiles: TOTAL_TILES },
    }
  }
}

function formatPrice(price: number): string {
  if (price === 0) return 'FREE'
  if (price % 1 === 0) return `$${price}`
  return `$${price.toFixed(2)}`
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ focusCampaign?: string }>
}) {
  const [pageData, settings, campaignPricing, sp] = await Promise.all([
    getPageData(),
    getAllSettings(),
    getCampaignPricing(),
    searchParams,
  ])
  const { tiles, stats } = pageData
  const focusCampaign = sp.focusCampaign

  const freeEnabled = settings.free_rental_enabled === 'true'
  const feePercent = Math.max(0, Math.min(100, parseFloat(settings.management_fee_percent) || 10))
  const distribPercent = 100 - feePercent
  const dailyDisplay = freeEnabled ? 'FREE' : formatPrice(campaignPricing.dailyPricePerTile)
  const boardMint = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''
  const homepageBanner = settings.homepage_banner_copy ?? ''

  const statsStrip = [
    { value: stats.paidActiveTiles.toLocaleString(), label: 'Paid Tiles', color: 'text-white' },
    { value: stats.availableTiles.toLocaleString(), label: 'Available', color: 'text-white/60' },
    { value: dailyDisplay, label: 'Daily / Tile', color: 'text-green-400' },
    { value: `${distribPercent}%`, label: 'To Holders', color: 'text-green-400' },
  ]

  return (
    <div>
      {/* Homepage banner (admin-controlled) */}
      {homepageBanner && (
        <div className="bg-amber-400/10 border-b border-amber-400/20 px-4 py-2 text-center text-xs text-amber-300">
          {homepageBanner}
        </div>
      )}

      {/* Above-fold: hero strip + full-height board */}
      <div
        className="flex flex-col"
        style={{ height: homepageBanner ? 'calc(100dvh - var(--nav-height) - 32px)' : 'calc(100dvh - var(--nav-height))' }}
      >

        {/* Hero strip */}
        <div className="flex-shrink-0 px-3 py-3 sm:px-4 border-b border-white/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">

            {/* Left: live badge + title + sublines */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <div className="inline-flex items-center gap-1.5 bg-green-400/10 border border-green-400/20 rounded-full px-2.5 py-1 text-[11px] text-green-400 font-medium whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  LIVE — {stats.paidActiveTiles.toLocaleString()} paid tiles
                </div>
                {freeEnabled && (
                  <span className="hidden sm:inline-flex items-center gap-1 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1 text-[11px] text-amber-400 whitespace-nowrap">
                    Free mode active
                  </span>
                )}
              </div>
              <h1 className="text-lg sm:text-2xl lg:text-3xl font-black tracking-tight text-white leading-tight">
                THE INTERNET BILLBOARD{' '}
                <span className="text-green-400">POWERED BY $BOARD</span>
              </h1>
              <p className="text-white/35 text-xs sm:text-sm mt-0.5 hidden sm:block">
                100,000 tiles · 1 billion $BOARD · One internet billboard.
              </p>
              <p className="text-white/20 text-[11px] mt-0.5 hidden md:block">
                Rent tiles. Own territory. Get seen by the $BOARD community. Recognized ad revenue flows into the distribution pool for eligible holders.
              </p>
            </div>

            {/* Right: stats + CTAs */}
            <div className="flex flex-col gap-2 sm:items-end sm:flex-shrink-0">
              {/* Mini stats strip */}
              <div className="hidden sm:flex items-center divide-x divide-white/10">
                {statsStrip.map(({ value, label, color }) => (
                  <div key={label} className="text-center px-3 first:pl-0 last:pr-0">
                    <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
                    <div className="text-[9px] text-white/25 uppercase tracking-widest mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <Link
                  href="/advertise"
                  className="min-h-10 inline-flex items-center justify-center bg-green-400 hover:bg-green-300 text-black font-bold px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm transition-colors whitespace-nowrap shadow-lg shadow-green-400/15"
                >
                  Rent Tiles →
                </Link>
                {boardMint ? (
                  <Link
                    href="/claim"
                    className="min-h-10 inline-flex items-center justify-center border border-white/15 hover:border-white/35 text-white/60 hover:text-white font-medium px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm transition-colors whitespace-nowrap"
                  >
                    Claim Revenue
                  </Link>
                ) : (
                  <Link
                    href="/stats"
                    className="min-h-10 inline-flex items-center justify-center border border-white/15 hover:border-white/35 text-white/60 hover:text-white font-medium px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm transition-colors whitespace-nowrap"
                  >
                    View Fee Pool
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Board viewport — fills remaining screen height */}
        <div className="flex-1 min-h-0">
          <HomeBillboard tiles={tiles} tilePrice={campaignPricing.dailyPricePerTile} focusCampaign={focusCampaign} />
        </div>
      </div>

      {/* How it works — below fold */}
      <section className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-black text-white mb-8 text-center">HOW IT WORKS</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              n: '01',
              title: 'Rent tiles',
              body: `Pick tiles on the grid, upload your ad, add your destination URL. Starting from ${dailyDisplay} USDC per tile for a daily campaign.`,
            },
            {
              n: '02',
              title: 'Go live',
              body: 'Your ad goes live after a quick review. Billing starts the day it runs — your balance is deducted daily.',
            },
            {
              n: '03',
              title: 'Revenue pools daily',
              body: `Recognized ad revenue accumulates in the distribution pool. ${distribPercent}% flows to eligible $BOARD holders each epoch.`,
            },
            {
              n: '04',
              title: 'Eligible holders claim',
              body: 'Connect your wallet and claim your snapshot-based share of the distribution pool based on your $BOARD balance.',
            },
          ].map(({ n, title, body }) => (
            <div
              key={n}
              className="border border-white/10 rounded-xl p-5 bg-white/2 hover:bg-white/5 transition-colors"
            >
              <div className="text-green-400 font-black text-xs tracking-widest mb-2">{n}</div>
              <div className="text-white font-bold mb-1">{title}</div>
              <div className="text-white/50 text-sm">{body}</div>
            </div>
          ))}
        </div>

        {/* $BOARD token card */}
        <div className="mt-8 border border-green-400/20 bg-green-400/5 rounded-xl p-6 text-center">
          {boardMint ? (
            <>
              <div className="text-xs text-green-400/70 uppercase tracking-widest mb-2">Live on Solana</div>
              <div className="text-2xl font-black text-white mb-2">$BOARD TOKEN</div>
              <div className="text-white/50 text-sm max-w-md mx-auto mb-4">
                Recognized ad revenue flows into the distribution pool each epoch. Eligible $BOARD holders
                can claim their snapshot-based share — fully on-chain and transparent.
              </div>
              <div className="grid gap-3 sm:flex sm:items-center sm:justify-center">
                <Link
                  href="/claim"
                  className="min-h-11 inline-flex items-center justify-center gap-1.5 bg-green-400 hover:bg-green-300 text-black font-bold px-5 py-2 rounded-lg text-sm transition-colors"
                >
                  Claim Revenue →
                </Link>
                <Link
                  href="/stats"
                  className="inline-flex items-center gap-1.5 border border-white/15 hover:border-white/30 text-white/60 hover:text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors"
                >
                  View Stats
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-green-400/70 uppercase tracking-widest mb-2">Coming soon</div>
              <div className="text-2xl font-black text-white mb-2">$BOARD TOKEN</div>
              <div className="text-white/50 text-sm max-w-md mx-auto mb-4">
                The native token powering BillionBoard revenue distribution. Launching on Solana.
                Billboard revenue is already accumulating for day-one holders.
              </div>
              <Link
                href="/stats"
                className="inline-flex items-center gap-1.5 border border-white/15 hover:border-white/30 text-white/60 hover:text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors"
              >
                View Fee Pool →
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
