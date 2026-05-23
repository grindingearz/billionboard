import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import HomeBillboard from '@/components/HomeBillboard'
import { TOTAL_TILES } from '@/lib/types'
import type { TileInfoMap } from '@/lib/types'
import { getAllSettings } from '@/lib/settings'

async function getStats() {
  try {
    const [activeTiles, pendingTiles] = await Promise.all([
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
    ])
    return { activeTiles, pendingTiles, availableTiles: TOTAL_TILES - activeTiles - pendingTiles }
  } catch {
    return { activeTiles: 0, pendingTiles: 0, availableTiles: TOTAL_TILES }
  }
}

async function getTileData(): Promise<TileInfoMap> {
  try {
    const rentals = await prisma.adRental.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'ACTIVE'] } },
      select: {
        tileId: true,
        status: true,
        creativeId: true,
        creative: { select: { imageUrl: true, destUrl: true, altText: true, displayMode: true } },
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

export default async function HomePage() {
  const [stats, tiles, settings] = await Promise.all([
    getStats(),
    getTileData(),
    getAllSettings(),
  ])

  const tilePrice = Math.max(0, parseFloat(settings.tile_price_usd_per_day) || 1)
  const freeEnabled = settings.free_rental_enabled === 'true'
  const freeDays = parseInt(settings.free_rental_days, 10) || 0
  const priceDisplay = formatPrice(tilePrice)
  const dailyRevenue = stats.activeTiles * tilePrice

  return (
    <div>
      {/* Above-fold: compact hero strip + full-height board in one viewport */}
      <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

        {/* Compact hero strip */}
        <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="inline-flex items-center gap-1.5 bg-green-400/10 border border-green-400/20 rounded-full px-2.5 py-1 text-[11px] text-green-400 font-medium whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE — {stats.activeTiles.toLocaleString()} tiles rented
            </div>
            <h1 className="text-lg sm:text-2xl font-black tracking-tight text-white whitespace-nowrap">
              THE WORLD&apos;S BIGGEST{' '}
              <span className="text-green-400">INTERNET BILLBOARD</span>
            </h1>
            <span className="hidden lg:block text-white/25 text-xs whitespace-nowrap">
              1B pixels · {priceDisplay}/tile/day
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {freeEnabled && freeDays > 0 && (
              <span className="hidden sm:flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/20 rounded-full px-3 py-1 text-xs text-amber-400 whitespace-nowrap">
                {freeDays}d free
                {tilePrice > 0 && <span className="text-amber-400/60">· then {priceDisplay}</span>}
              </span>
            )}
            <Link
              href="/advertise"
              className="bg-green-400 hover:bg-green-300 text-black font-bold px-4 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap"
            >
              Rent Tiles →
            </Link>
            <Link
              href="/claim"
              className="border border-white/20 hover:border-white/40 text-white font-medium px-4 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap"
            >
              Claim Revenue
            </Link>
          </div>
        </div>

        {/* Billboard fills all remaining viewport height */}
        <div className="flex-1 min-h-0">
          <HomeBillboard tiles={tiles} tilePrice={tilePrice} />
        </div>
      </div>

      {/* Stats bar */}
      <section className="border-y border-white/10 py-6 mb-16">
        <div className="max-w-4xl mx-auto px-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-black text-white">{stats.activeTiles.toLocaleString()}</div>
            <div className="text-xs text-white/40 mt-1 uppercase tracking-widest">Active tiles</div>
          </div>
          <div>
            <div className="text-2xl font-black text-green-400">
              ${dailyRevenue % 1 === 0 ? dailyRevenue.toLocaleString() : dailyRevenue.toFixed(2)}
            </div>
            <div className="text-xs text-white/40 mt-1 uppercase tracking-widest">Daily revenue</div>
          </div>
          <div>
            <div className="text-2xl font-black text-white">
              {stats.availableTiles.toLocaleString()}
            </div>
            <div className="text-xs text-white/40 mt-1 uppercase tracking-widest">Tiles available</div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-4 pb-24">
        <h2 className="text-2xl font-black text-white mb-8 text-center">HOW IT WORKS</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              n: '01',
              title: 'Rent tiles',
              body: `Pick tiles on the grid, upload your ad, add your URL. Pay ${priceDisplay} USDC per tile per day.`,
            },
            {
              n: '02',
              title: 'Get approved',
              body: 'Our team reviews your ad. Once approved it goes live on the billboard.',
            },
            {
              n: '03',
              title: 'Revenue pools daily',
              body: "Every day's rent is added to the claim pool for $BOARD holders.",
            },
            {
              n: '04',
              title: 'Holders claim',
              body: 'Connect your wallet. Claim your pro-rata share of daily revenue based on your $BOARD balance.',
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

        <div className="mt-8 border border-green-400/20 bg-green-400/5 rounded-xl p-6 text-center">
          <div className="text-xs text-green-400/70 uppercase tracking-widest mb-2">Coming soon</div>
          <div className="text-2xl font-black text-white mb-2">$BOARD TOKEN</div>
          <div className="text-white/50 text-sm max-w-md mx-auto">
            The native token powering BillionBoard revenue distribution. Launching on Solana.
          </div>
        </div>
      </section>
    </div>
  )
}
