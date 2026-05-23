import { prisma } from '@/lib/prisma'
import { TOTAL_TILES } from '@/lib/types'
import { getTilePrice, getSetting } from '@/lib/settings'
import { getOrCreateEpoch, todayUtc, msUntilUtcClose, formatUtcDate } from '@/lib/epoch'

async function getStats() {
  try {
    const now = new Date()
    const today = todayUtc()
    const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))

    const [
      activeTiles,
      pendingTiles,
      revenueAgg,
      activeAdvertisers,
      billingRuns,
      epochHistory,
      todayAd,
      todayFee,
      totalDistributed,
      totalClaimPoolAllocated,
      tilePrice,
      feePercentStr,
      currentEpoch,
    ] = await Promise.all([
      prisma.adRental.count({ where: { status: 'ACTIVE' } }),
      prisma.adRental.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.revenueEvent.aggregate({
        where: { type: { in: ['AD_RENT_REVENUE', 'TRADING_FEE_REVENUE'] } },
        _sum: { amount: true },
      }),
      prisma.adRental
        .findMany({ where: { status: 'ACTIVE' }, select: { userId: true }, distinct: ['userId'] })
        .then((rows) => rows.length),
      prisma.dailyBillingRun.findMany({
        orderBy: { runDate: 'desc' },
        take: 14,
        select: { runDate: true, tilesCharged: true, totalRevenue: true, status: true },
      }),
      prisma.distributionEpoch.findMany({
        orderBy: { epochDate: 'desc' },
        take: 30,
        select: {
          epochDate: true,
          adRevenue: true,
          tradingFeeRevenue: true,
          grossPool: true,
          managementFeePercent: true,
          managementFeeAmount: true,
          claimPoolAmount: true,
          totalPool: true,
          eligibleSupply: true,
          snapshotDate: true,
          status: true,
        },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'AD_RENT_REVENUE', createdAt: { gte: today, lte: todayEnd } },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'TRADING_FEE_REVENUE', createdAt: { gte: today, lte: todayEnd } },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'CLAIM_PAYOUT' },
        _sum: { amount: true },
      }),
      prisma.revenueEvent.aggregate({
        where: { type: 'CLAIM_POOL_ALLOCATION' },
        _sum: { amount: true },
      }),
      getTilePrice(),
      getSetting('management_fee_percent'),
      getOrCreateEpoch(today),
    ])

    const todayAdRevenue = Number(todayAd._sum.amount ?? 0)
    const todayFeeRevenue = Number(todayFee._sum.amount ?? 0)
    const todayGross = todayAdRevenue + todayFeeRevenue
    const feePercent = Math.max(0, Math.min(100, parseFloat(feePercentStr) || 10))
    const todayMgmtFee = todayGross * (feePercent / 100)
    const todayClaimPool = todayGross - todayMgmtFee

    return {
      activeTiles,
      pendingTiles,
      availableTiles: TOTAL_TILES - activeTiles - pendingTiles,
      activeAdvertisers,
      totalRevenue: Number(revenueAgg._sum.amount ?? 0),
      totalDistributed: Number(totalDistributed._sum.amount ?? 0),
      totalClaimPoolAllocated: Number(totalClaimPoolAllocated._sum.amount ?? 0),
      tilePrice,
      feePercent,
      msUntilClose: msUntilUtcClose(),
      today: {
        adRevenue: todayAdRevenue,
        feeRevenue: todayFeeRevenue,
        grossPool: todayGross,
        managementFee: todayMgmtFee,
        claimPool: todayClaimPool,
      },
      currentEpochStatus: currentEpoch.status,
      epochHistory,
      billingRuns,
    }
  } catch {
    return {
      activeTiles: 0,
      pendingTiles: 0,
      availableTiles: TOTAL_TILES,
      activeAdvertisers: 0,
      totalRevenue: 0,
      totalDistributed: 0,
      totalClaimPoolAllocated: 0,
      tilePrice: 1,
      feePercent: 10,
      msUntilClose: 0,
      today: { adRevenue: 0, feeRevenue: 0, grossPool: 0, managementFee: 0, claimPool: 0 },
      currentEpochStatus: 'OPEN',
      epochHistory: [] as Array<{
        epochDate: Date
        adRevenue: unknown
        tradingFeeRevenue: unknown
        grossPool: unknown
        managementFeePercent: unknown
        managementFeeAmount: unknown
        claimPoolAmount: unknown
        totalPool: unknown
        eligibleSupply: string | null
        snapshotDate: Date | null
        status: string
      }>,
      billingRuns: [] as Array<{
        runDate: Date
        tilesCharged: number
        totalRevenue: unknown
        status: string
      }>,
    }
  }
}

function fmt(n: number) {
  return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0h 0m'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m}m`
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-blue-400/10 text-blue-400',
  PROCESSING: 'bg-amber-400/10 text-amber-400',
  FAILED: 'bg-red-400/10 text-red-400',
  DRAFT: 'bg-white/10 text-white/50',
  BILLED: 'bg-amber-400/10 text-amber-400',
  SNAPSHOTTED: 'bg-purple-400/10 text-purple-400',
  PUBLISHED: 'bg-green-400/10 text-green-400',
  CLOSED: 'bg-white/10 text-white/40',
  READY_NO_TOKEN: 'bg-white/10 text-white/50',
}

export default async function StatsPage() {
  const s = await getStats()
  const projectedDaily = s.activeTiles * s.tilePrice
  const boardMint = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''

  return (
    <div className="min-h-screen max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-black text-white mb-1">Stats</h1>
      <p className="text-white/40 text-sm mb-10">Live revenue and distribution pool data</p>

      {/* KPI grid — 7 items */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Active tiles', value: s.activeTiles.toLocaleString(), color: 'text-green-400' },
          { label: 'Active advertisers', value: s.activeAdvertisers.toLocaleString(), color: 'text-green-400' },
          { label: 'Ad revenue today', value: `$${fmt(s.today.adRevenue)}`, color: 'text-green-400' },
          { label: 'Trading fee today', value: `$${fmt(s.today.feeRevenue)}`, color: 'text-blue-400' },
          { label: "Today's claim pool", value: `$${fmt(s.today.claimPool)}`, color: 'text-green-400' },
          { label: 'Total claim pool allocated', value: `$${fmt(s.totalClaimPoolAllocated)}`, color: 'text-white' },
          { label: 'Total distributed', value: `$${fmt(s.totalDistributed)}`, color: 'text-white/70' },
        ].map(({ label, value, color }) => (
          <div key={label} className="border border-white/10 rounded-xl p-4 bg-white/2">
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="text-xs text-white/40 mt-1 uppercase tracking-widest">{label}</div>
          </div>
        ))}
      </div>

      {/* Daily Fee Pools */}
      <div className="mb-10">
        <h2 className="text-lg font-bold text-white mb-1">Daily Fee Pools</h2>
        <p className="text-xs text-white/40 mb-5 leading-relaxed">
          Advertiser top-ups are not counted as revenue. Only daily tile rental deductions and
          verified trading fee revenue enter the fee pool. Claim pools are calculated on 24-hour
          UTC epochs.
        </p>

        {/* Current epoch card */}
        <div className="border border-white/10 rounded-xl p-5 mb-6 bg-white/2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs text-white/40 uppercase tracking-widest mb-1">Current epoch</div>
              <div className="text-sm font-mono text-white">{formatUtcDate(new Date())}</div>
            </div>
            <div className="text-right">
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[s.currentEpochStatus] ?? 'bg-white/10 text-white/40'}`}
              >
                {s.currentEpochStatus}
              </span>
              <div className="text-xs text-white/30 mt-1">Closes in {fmtCountdown(s.msUntilClose)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {[
              { label: 'Advertising fees', value: `$${fmt(s.today.adRevenue)}`, color: 'text-green-400' },
              { label: 'Trading fees', value: `$${fmt(s.today.feeRevenue)}`, color: 'text-blue-400' },
              { label: 'Gross fees', value: `$${fmt(s.today.grossPool)}`, color: 'text-white' },
              { label: `Mgmt fee (${s.feePercent}%)`, value: `$${fmt(s.today.managementFee)}`, color: 'text-white/50' },
              { label: 'Balance to distribute', value: `$${fmt(s.today.claimPool)}`, color: 'text-green-400' },
              {
                label: '$BOARD mint',
                value: boardMint ? 'Configured' : 'Not configured',
                color: boardMint ? 'text-green-400' : 'text-amber-400',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/3 rounded-lg p-3">
                <div className={`font-mono font-bold ${color}`}>{value}</div>
                <div className="text-white/40 mt-0.5 uppercase tracking-wider">{label}</div>
              </div>
            ))}
          </div>
          {!boardMint && (
            <div className="mt-4 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/10 rounded-lg px-3 py-2">
              $BOARD claim snapshots activate after token launch.
            </div>
          )}
          {s.today.feeRevenue === 0 && (
            <div className="mt-3 text-xs text-white/30">
              Trading fee tracking activates after $BOARD launch.
            </div>
          )}
        </div>

        {/* Epoch history table */}
        {s.epochHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 uppercase tracking-widest border-b border-white/10">
                  <th className="pb-2 text-left font-medium whitespace-nowrap">Date</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">Ad Fees</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">Trading Fees</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">Gross</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">Mgmt %</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">Mgmt $</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">To Distribute</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">Supply</th>
                  <th className="pb-2 text-right font-medium whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {s.epochHistory.map((ep) => {
                  const claimPool = Number(ep.claimPoolAmount || ep.totalPool)
                  return (
                    <tr
                      key={ep.epochDate.toString()}
                      className="border-b border-white/5 hover:bg-white/2 transition-colors"
                    >
                      <td className="py-2.5 text-white/70 font-mono whitespace-nowrap">
                        {formatUtcDate(ep.epochDate)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-green-400">
                        ${fmt(Number(ep.adRevenue ?? 0))}
                      </td>
                      <td className="py-2.5 text-right font-mono text-blue-400">
                        ${fmt(Number(ep.tradingFeeRevenue ?? 0))}
                      </td>
                      <td className="py-2.5 text-right font-mono text-white/70">
                        ${fmt(Number(ep.grossPool ?? 0))}
                      </td>
                      <td className="py-2.5 text-right font-mono text-white/50">
                        {Number(ep.managementFeePercent ?? 0).toFixed(1)}%
                      </td>
                      <td className="py-2.5 text-right font-mono text-white/50">
                        ${fmt(Number(ep.managementFeeAmount ?? 0))}
                      </td>
                      <td className="py-2.5 text-right font-mono text-green-400">
                        ${fmt(claimPool)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-white/40">
                        {ep.eligibleSupply != null ? String(ep.eligibleSupply) : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[ep.status] ?? 'bg-white/10 text-white/40'}`}
                        >
                          {ep.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-white/30 py-8 border border-white/10 rounded-xl">
            No epoch history yet. Distribution data appears here after the first billing run.
          </div>
        )}
      </div>

      {/* Daily projection */}
      <div className="border border-green-400/20 bg-green-400/5 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-green-400/70 uppercase tracking-widest mb-1">
              Today&apos;s projected revenue
            </div>
            <div className="text-3xl font-black text-green-400">${fmt(projectedDaily)}</div>
          </div>
          <div className="text-right text-xs text-white/30">
            <div>{s.activeTiles.toLocaleString()} active tiles</div>
            <div>× ${s.tilePrice.toFixed(2)}/tile/day</div>
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
          <span><span className="text-green-400">■</span> Active</span>
          <span><span className="text-amber-400">■</span> Pending</span>
          <span><span className="text-white/20">■</span> Available</span>
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

      {s.billingRuns.length === 0 && s.epochHistory.length === 0 && (
        <div className="text-center text-white/30 py-12">
          No billing data yet. Revenue starts flowing once ads go live.
        </div>
      )}
    </div>
  )
}
