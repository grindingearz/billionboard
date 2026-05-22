import { prisma } from '@/lib/prisma'
import { TOTAL_TILES } from '@/lib/types'

async function getStats() {
  try {
    const [activeTiles, pendingTiles, revenueAgg, billingRuns, epochs] = await Promise.all([
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.revenueEvent.aggregate({ _sum: { amount: true } }),
      prisma.dailyBillingRun.findMany({
        orderBy: { runDate: 'desc' },
        take: 14,
        select: { runDate: true, tilesCharged: true, totalRevenue: true, status: true },
      }),
      prisma.distributionEpoch.findMany({
        orderBy: { epochDate: 'desc' },
        take: 5,
        select: { epochDate: true, totalPool: true, status: true },
      }),
    ])
    return {
      activeTiles,
      pendingTiles,
      availableTiles: TOTAL_TILES - activeTiles - pendingTiles,
      totalRevenue: Number(revenueAgg._sum.amount ?? 0),
      billingRuns,
      epochs,
    }
  } catch {
    return {
      activeTiles: 0,
      pendingTiles: 0,
      availableTiles: TOTAL_TILES,
      totalRevenue: 0,
      billingRuns: [],
      epochs: [],
    }
  }
}

export default async function StatsPage() {
  const s = await getStats()
  const dailyRevenue = s.activeTiles * 1

  return (
    <div className="min-h-screen max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-black text-white mb-1">Stats</h1>
      <p className="text-white/40 text-sm mb-10">Live revenue and distribution pool data</p>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Active tiles', value: s.activeTiles.toLocaleString(), color: 'text-green-400' },
          { label: 'Pending tiles', value: s.pendingTiles.toLocaleString(), color: 'text-amber-400' },
          {
            label: 'Available tiles',
            value: s.availableTiles.toLocaleString(),
            color: 'text-white',
          },
          {
            label: 'Total revenue',
            value: `$${s.totalRevenue.toLocaleString('en', { minimumFractionDigits: 2 })}`,
            color: 'text-green-400',
          },
        ].map(({ label, value, color }) => (
          <div key={label} className="border border-white/10 rounded-xl p-4 bg-white/2">
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="text-xs text-white/40 mt-1 uppercase tracking-widest">{label}</div>
          </div>
        ))}
      </div>

      {/* Daily projection */}
      <div className="border border-green-400/20 bg-green-400/5 rounded-xl p-5 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-green-400/70 uppercase tracking-widest mb-1">
              Today&apos;s projected revenue
            </div>
            <div className="text-3xl font-black text-green-400">${dailyRevenue.toLocaleString()}</div>
          </div>
          <div className="text-right text-xs text-white/30">
            <div>{s.activeTiles.toLocaleString()} active tiles</div>
            <div>× $1.00/tile/day</div>
          </div>
        </div>
      </div>

      {/* Tile occupancy bar */}
      <div className="border border-white/10 rounded-xl p-5 mb-8">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-bold text-white">Tile Occupancy</span>
          <span className="text-xs text-white/40">
            {((s.activeTiles / TOTAL_TILES) * 100).toFixed(3)}% full
          </span>
        </div>
        <div className="h-3 bg-white/5 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-green-600 transition-all"
            style={{ width: `${(s.activeTiles / TOTAL_TILES) * 100}%` }}
          />
          <div
            className="h-full bg-amber-600 transition-all"
            style={{ width: `${(s.pendingTiles / TOTAL_TILES) * 100}%` }}
          />
        </div>
        <div className="flex gap-4 mt-2 text-xs text-white/40">
          <span>
            <span className="text-green-400">■</span> Active
          </span>
          <span>
            <span className="text-amber-400">■</span> Pending
          </span>
          <span>
            <span className="text-white/20">■</span> Available
          </span>
        </div>
      </div>

      {/* Recent billing runs */}
      {s.billingRuns.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-bold text-white mb-3">Recent billing runs (last 14 days)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
                  <th className="pb-2 text-left font-medium">Date</th>
                  <th className="pb-2 text-right font-medium">Tiles</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                  <th className="pb-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {s.billingRuns.map((r) => (
                  <tr
                    key={r.runDate.toString()}
                    className="border-b border-white/5 hover:bg-white/2 transition-colors"
                  >
                    <td className="py-2.5 text-white/70">
                      {new Date(r.runDate).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 text-right font-mono text-white/70">
                      {r.tilesCharged.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right font-mono text-green-400">
                      ${Number(r.totalRevenue).toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          r.status === 'completed'
                            ? 'bg-green-400/10 text-green-400'
                            : r.status === 'failed'
                              ? 'bg-red-400/10 text-red-400'
                              : 'bg-white/10 text-white/50'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Distribution epochs */}
      {s.epochs.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-white mb-3">Distribution epochs</h2>
          <div className="space-y-2">
            {s.epochs.map((ep) => (
              <div
                key={ep.epochDate.toString()}
                className="flex items-center justify-between border border-white/10 rounded-lg px-4 py-3 bg-white/2"
              >
                <div>
                  <div className="text-sm text-white">
                    {new Date(ep.epochDate).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-green-400">${Number(ep.totalPool).toFixed(2)}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      ep.status === 'PUBLISHED'
                        ? 'bg-green-400/10 text-green-400'
                        : ep.status === 'CLOSED'
                          ? 'bg-white/10 text-white/40'
                          : 'bg-amber-400/10 text-amber-400'
                    }`}
                  >
                    {ep.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.billingRuns.length === 0 && s.epochs.length === 0 && (
        <div className="text-center text-white/30 py-12">
          No billing data yet. Revenue starts flowing once ads go live.
        </div>
      )}
    </div>
  )
}
