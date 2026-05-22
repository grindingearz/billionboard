import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import HomeBillboard from '@/components/HomeBillboard'

async function getStats() {
  try {
    const [activeTiles, pendingTiles] = await Promise.all([
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
    ])
    return { activeTiles, pendingTiles, availableTiles: 100000 - activeTiles - pendingTiles }
  } catch {
    return { activeTiles: 0, pendingTiles: 0, availableTiles: 100000 }
  }
}

async function getTileStatuses() {
  try {
    const rentals = await prisma.adRental.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'ACTIVE'] } },
      select: { tileId: true, status: true },
    })
    const tiles: Record<number, 'ACTIVE' | 'PENDING'> = {}
    for (const r of rentals) {
      tiles[r.tileId] = r.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING'
    }
    return tiles
  } catch {
    return {}
  }
}

export default async function HomePage() {
  const [stats, tiles] = await Promise.all([getStats(), getTileStatuses()])

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="px-4 pt-16 pb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-green-400/10 border border-green-400/20 rounded-full px-3 py-1 text-xs text-green-400 font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          LIVE — {stats.activeTiles.toLocaleString()} tiles rented
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white mb-4">
          THE WORLD&apos;S BIGGEST
          <br />
          <span className="text-green-400">INTERNET BILLBOARD</span>
        </h1>

        <p className="text-white/50 text-lg max-w-xl mx-auto mb-10">
          1,000,000,000 pixels. 100,000 tiles. $1 per tile per day.
          <br />
          Revenue shared daily with $BOARD holders.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
          <Link
            href="/advertise"
            className="bg-green-400 hover:bg-green-300 text-black font-bold px-6 py-3 rounded-lg text-sm transition-colors"
          >
            Rent Tiles →
          </Link>
          <Link
            href="/claim"
            className="border border-white/20 hover:border-white/40 text-white font-medium px-6 py-3 rounded-lg text-sm transition-colors"
          >
            Claim Revenue
          </Link>
        </div>
      </section>

      {/* Billboard */}
      <section className="px-4 mb-12">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl shadow-green-400/5">
            <HomeBillboard tiles={tiles} />
          </div>
          <div className="flex justify-center gap-6 mt-4 text-xs text-white/30">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#141414] border border-white/10" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-600" />
              Pending
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-700" />
              Active
            </span>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-white/10 py-6 mb-16">
        <div className="max-w-4xl mx-auto px-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-black text-white">{stats.activeTiles.toLocaleString()}</div>
            <div className="text-xs text-white/40 mt-1 uppercase tracking-widest">Active tiles</div>
          </div>
          <div>
            <div className="text-2xl font-black text-green-400">
              ${stats.activeTiles.toLocaleString()}
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
              body: 'Pick tiles on the grid, upload your ad, add your URL. Pay $1 USDC per tile per day.',
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

        {/* Token section */}
        <div className="mt-8 border border-green-400/20 bg-green-400/5 rounded-xl p-6 text-center">
          <div className="text-xs text-green-400/70 uppercase tracking-widest mb-2">Coming soon</div>
          <div className="text-2xl font-black text-white mb-2">$BOARD TOKEN</div>
          <div className="text-white/50 text-sm max-w-md mx-auto">
            The native token powering BillionBoard revenue distribution. Launching on Solana.
            {/* TODO: add real Pump.fun launch link */}
          </div>
        </div>
      </section>
    </div>
  )
}
