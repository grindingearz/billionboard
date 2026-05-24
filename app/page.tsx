import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import HomeBillboard from '@/components/HomeBillboard'
import { TOTAL_TILES } from '@/lib/types'
import type { TileInfoMap } from '@/lib/types'
import { getAllSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

async function getStats() {
  try {
    const [activeTiles, pendingTiles] = await Promise.all([
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
    ])
    return {
      activeTiles,
      pendingTiles,
      availableTiles: TOTAL_TILES - activeTiles - pendingTiles,
    }
  } catch {
    return { activeTiles: 0, pendingTiles: 0, availableTiles: TOTAL_TILES }
  }
}

async function getTileData(): Promise<TileInfoMap> {
  try {
    const rentals = await prisma.adRental.findMany({
      where: { status: 'ACTIVE' },
      select: {
        tileId: true,
        creativeId: true,
        creative: { select: { imageUrl: true, destUrl: true, altText: true, displayMode: true } },
      },
    })
    const tiles: TileInfoMap = {}
    for (const r of rentals) {
      tiles[r.tileId] = {
        status: 'ACTIVE',
        creativeId: r.creativeId ?? undefined,
        imageUrl: r.creative?.imageUrl ?? undefined,
        destUrl: r.creative?.destUrl ?? undefined,
        altText: r.creative?.altText ?? undefined,
        displayMode: (r.creative?.displayMode ?? 'REPEAT') as 'REPEAT' | 'STRETCH',
      }
    }
    return tiles
  } catch {
    return {}
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
  const [stats, tiles, settings, sp] = await Promise.all([
    getStats(),
    getTileData(),
    getAllSettings(),
    searchParams,
  ])
  const focusCampaign = sp.focusCampaign

  const tilePrice = Math.max(0, parseFloat(settings.tile_price_usd_per_day) || 1)
  const freeEnabled = settings.free_rental_enabled === 'true'
  const freeDays = parseInt(settings.free_rental_days, 10) || 0
  const feePercent = Math.max(0, Math.min(100, parseFloat(settings.management_fee_percent) || 10))
  const distribPercent = 100 - feePercent
  const priceDisplay = formatPrice(tilePrice)
  const boardMint = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''

  const statsStrip = [
    { value: stats.activeTiles.toLocaleString(), label: 'Rented', color: 'text-white' },
    { value: stats.availableTiles.toLocaleString(), label: 'Available', color: 'text-white/60' },
    { value: priceDisplay, label: 'Per Tile / Day', color: 'text-green-400' },
    { value: `${distribPercent}%`, label: 'To Holders', color: 'text-green-400' },
  ]

  return (
    <div>
      {/* Above-fold: hero strip + full-height board */}
      <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

        {/* Hero strip */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">

            {/* Left: live badge + title + sublines */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <div className="inline-flex items-center gap-1.5 bg-green-400/10 border border-green-400/20 rounded-full px-2.5 py-1 text-[11px] text-green-400 font-medium whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  LIVE — {stats.activeTiles.toLocaleString()} tiles rented
                </div>
                {freeEnabled && freeDays > 0 && (
                  <span className="hidden sm:inline-flex items-center gap-1 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1 text-[11px] text-amber-400 whitespace-nowrap">
                    {freeDays}d free
                    {tilePrice > 0 && <span className="text-amber-400/60"> · then {priceDisplay}</span>}
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight text-white leading-tight">
                THE WORLD&apos;S BIGGEST{' '}
                <span className="text-green-400">INTERNET BILLBOARD</span>
              </h1>
              <p className="text-white/35 text-xs sm:text-sm mt-0.5 hidden sm:block">
                1B pixels · 100,000 rentable tiles · Ads live instantly
              </p>
              <p className="text-white/20 text-[11px] mt-0.5 hidden md:block">
                {boardMint
                  ? 'Earned fees flow transparently to the daily $BOARD distribution pool.'
                  : 'Distribution activates after $BOARD launch.'}
              </p>
            </div>

            {/* Right: stats + CTAs */}
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
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
              <div className="flex items-center gap-2">
                <Link
                  href="/advertise"
                  className="bg-green-400 hover:bg-green-300 text-black font-bold px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap shadow-lg shadow-green-400/15"
                >
                  Rent Tiles →
                </Link>
                {boardMint ? (
                  <Link
                    href="/claim"
                    className="border border-white/15 hover:border-white/35 text-white/60 hover:text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
                  >
                    Claim Revenue
                  </Link>
                ) : (
                  <Link
                    href="/stats"
                    className="border border-white/15 hover:border-white/35 text-white/60 hover:text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
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
          <HomeBillboard tiles={tiles} tilePrice={tilePrice} focusCampaign={focusCampaign} />
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
              body: `Pick tiles on the grid, upload your ad, add your destination URL. Pay ${priceDisplay} USDC per tile per day.`,
            },
            {
              n: '02',
              title: 'Go live',
              body: 'Your ad goes live after a quick review. Billing starts the day it runs — your balance is deducted daily.',
            },
            {
              n: '03',
              title: 'Revenue pools daily',
              body: `Every day's rent accumulates in the claim pool. ${distribPercent}% flows to $BOARD holders each epoch.`,
            },
            {
              n: '04',
              title: 'Holders claim',
              body: 'Connect your wallet and claim your pro-rata share of daily billboard revenue based on your $BOARD balance.',
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
                Earn daily USDC revenue by holding $BOARD. Advertising fees flow from the billboard to
                holders every epoch — fully on-chain and transparent.
              </div>
              <div className="flex items-center justify-center gap-3">
                <Link
                  href="/claim"
                  className="inline-flex items-center gap-1.5 bg-green-400 hover:bg-green-300 text-black font-bold px-5 py-2 rounded-lg text-sm transition-colors"
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
