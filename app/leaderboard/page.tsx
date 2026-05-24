'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type LeaderboardEntry = {
  creativeId: string
  displayName: string
  destUrl: string
  imageUrl: string
  durationType: string | null
  activeTiles: number
  boardSharePercent: number
  daysRemaining: number
  billboardPower: number
  totalClicks: number
  clicks24h: number
  campaignStartAt: string | null
  campaignEndAt: string | null
}

type Stats = {
  totalActiveCampaigns: number
  totalActiveTiles: number
  totalClicks: number
  totalClicks24h: number
}

type TabKey = 'biggestTerritory' | 'billboardPower' | 'todaysTakeover' | 'mostClicked' | 'newCampaigns' | 'expiringSoon'

const TABS: { key: TabKey; label: string; subtitle: string }[] = [
  { key: 'biggestTerritory', label: 'Biggest Territory', subtitle: 'Most tiles owned' },
  { key: 'billboardPower', label: 'Billboard Power', subtitle: 'Tiles × days remaining' },
  { key: 'todaysTakeover', label: "Today's Takeover", subtitle: '% of the board' },
  { key: 'mostClicked', label: 'Most Clicked', subtitle: 'All-time clicks' },
  { key: 'newCampaigns', label: 'New Campaigns', subtitle: 'Recently launched' },
  { key: 'expiringSoon', label: 'Expiring Soon', subtitle: 'Last chance to see' },
]

function metricValue(entry: LeaderboardEntry, tab: TabKey): string {
  switch (tab) {
    case 'biggestTerritory': return `${entry.activeTiles.toLocaleString()} tiles`
    case 'billboardPower': return entry.billboardPower.toLocaleString()
    case 'todaysTakeover': return `${entry.boardSharePercent.toFixed(4)}%`
    case 'mostClicked': return `${entry.totalClicks.toLocaleString()} clicks`
    case 'newCampaigns': return entry.campaignStartAt
      ? new Date(entry.campaignStartAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—'
    case 'expiringSoon': return entry.daysRemaining === 1
      ? '1 day left'
      : `${entry.daysRemaining} days left`
  }
}

function RankBadge({ rank }: { rank: number }) {
  const gold = rank === 1
  const silver = rank === 2
  const bronze = rank === 3
  const cls = gold
    ? 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30'
    : silver
    ? 'bg-gray-400/20 text-gray-300 border-gray-400/30'
    : bronze
    ? 'bg-orange-400/20 text-orange-400 border-orange-400/30'
    : 'bg-white/5 text-white/30 border-white/10'
  return (
    <div className={`border rounded-md w-8 h-8 flex items-center justify-center font-black text-xs shrink-0 ${cls}`}>
      {rank}
    </div>
  )
}

function FullCard({
  entry,
  rank,
  tab,
}: {
  entry: LeaderboardEntry
  rank: number
  tab: TabKey
}) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-white/3 hover:bg-white/5 transition-colors group">
      {entry.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.imageUrl}
          alt={entry.displayName}
          className="w-full h-32 object-cover"
        />
      )}
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <RankBadge rank={rank} />
          <div className="min-w-0 flex-1">
            <div className="text-white font-bold text-sm truncate" title={entry.displayName}>
              {entry.displayName}
            </div>
            <div className="text-white/35 text-xs truncate">{entry.destUrl.replace(/^https?:\/\//, '')}</div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="text-green-400 font-bold text-sm">{metricValue(entry, tab)}</div>
          {entry.durationType && (
            <span className="text-[10px] border border-white/10 text-white/30 rounded px-1.5 py-0.5 uppercase tracking-wide">
              {entry.durationType}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-white/25 mb-3">
          <span>{entry.activeTiles.toLocaleString()} tiles</span>
          <span className="text-white/10">·</span>
          <span>{entry.boardSharePercent.toFixed(3)}% of board</span>
          {entry.clicks24h > 0 && (
            <>
              <span className="text-white/10">·</span>
              <span className="text-green-400/60">{entry.clicks24h} clicks today</span>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <Link
            href={`/?focusCampaign=${entry.creativeId}`}
            className="flex-1 text-center text-[11px] border border-white/10 text-white/40 hover:text-white/70 hover:border-white/25 rounded-lg py-1.5 transition-colors"
          >
            View on Board
          </Link>
          <a
            href={`/api/click/${entry.creativeId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center text-[11px] bg-green-400/10 border border-green-400/20 text-green-400 hover:bg-green-400/20 rounded-lg py-1.5 transition-colors"
          >
            Visit →
          </a>
        </div>
      </div>
    </div>
  )
}

function CompactRow({
  entry,
  rank,
  tab,
}: {
  entry: LeaderboardEntry
  rank: number
  tab: TabKey
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0 group">
      <RankBadge rank={rank} />
      {entry.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.imageUrl}
          alt={entry.displayName}
          className="w-10 h-10 rounded-lg object-cover shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-white/80 text-sm font-medium truncate">{entry.displayName}</div>
        <div className="text-white/25 text-[11px]">{entry.activeTiles.toLocaleString()} tiles</div>
      </div>
      <div className="text-green-400 text-sm font-bold tabular-nums shrink-0">{metricValue(entry, tab)}</div>
      <div className="flex gap-1.5 shrink-0">
        <Link
          href={`/?focusCampaign=${entry.creativeId}`}
          className="text-[10px] border border-white/10 text-white/30 hover:text-white/60 rounded px-2 py-1 transition-colors"
        >
          Map
        </Link>
        <a
          href={`/api/click/${entry.creativeId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] border border-green-400/20 text-green-400/60 hover:text-green-400 rounded px-2 py-1 transition-colors"
        >
          Visit
        </a>
      </div>
    </div>
  )
}

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('biggestTerritory')
  const [data, setData] = useState<{
    stats: Stats
    tabs: Record<TabKey, LeaderboardEntry[]>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load leaderboard'); setLoading(false) })
  }, [])

  const entries = data?.tabs[activeTab] ?? []
  const top10 = entries.slice(0, 10)
  const rest = entries.slice(10)

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/80 backdrop-blur sticky top-14 z-30">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight">
                LEADERBOARD
              </h1>
              <p className="text-white/40 text-sm">Live advertiser rankings across the billion-pixel board</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs font-medium">LIVE</span>
            </div>
          </div>

          {/* Stats bar */}
          {data && (
            <div className="flex flex-wrap gap-4 sm:gap-8 text-sm">
              {[
                { label: 'Active Campaigns', value: data.stats.totalActiveCampaigns.toLocaleString() },
                { label: 'Tiles in Use', value: data.stats.totalActiveTiles.toLocaleString() },
                { label: 'Board Coverage', value: `${((data.stats.totalActiveTiles / 100000) * 100).toFixed(2)}%` },
                { label: 'Clicks Today', value: data.stats.totalClicks24h.toLocaleString() },
                { label: 'Total Clicks', value: data.stats.totalClicks.toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-white font-bold tabular-nums">{value}</div>
                  <div className="text-white/30 text-[11px]">{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-0 overflow-x-auto scrollbar-none -mb-px">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-green-400 text-green-400'
                    : 'border-transparent text-white/40 hover:text-white/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {loading && (
          <div className="text-white/30 text-center py-20">Loading rankings...</div>
        )}
        {error && (
          <div className="text-red-400 text-center py-20">{error}</div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="text-center py-20">
            <div className="text-white/20 text-lg mb-2">No campaigns yet</div>
            <p className="text-white/15 text-sm mb-6">Be the first to claim your territory on the board.</p>
            <Link
              href="/advertise"
              className="inline-flex items-center gap-2 bg-green-400 hover:bg-green-300 text-black font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              Launch a Campaign →
            </Link>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <>
            {/* Tab subtitle */}
            <div className="text-white/30 text-sm mb-5">
              {TABS.find((t) => t.key === activeTab)?.subtitle} · {entries.length} campaign{entries.length !== 1 ? 's' : ''}
            </div>

            {/* Top 10 — full cards grid */}
            {top10.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
                {top10.map((entry, i) => (
                  <FullCard key={entry.creativeId} entry={entry} rank={i + 1} tab={activeTab} />
                ))}
              </div>
            )}

            {/* Ranks 11–50 — compact list */}
            {rest.length > 0 && (
              <div className="border border-white/10 rounded-xl bg-white/2 px-4">
                <div className="py-3 border-b border-white/5 text-[11px] text-white/25 uppercase tracking-widest">
                  Ranks 11–{10 + rest.length}
                </div>
                {rest.map((entry, i) => (
                  <CompactRow key={entry.creativeId} entry={entry} rank={i + 11} tab={activeTab} />
                ))}
              </div>
            )}

            {/* CTA */}
            <div className="mt-10 border border-green-400/15 bg-green-400/5 rounded-xl p-6 text-center">
              <div className="text-white font-bold mb-1">Want your campaign here?</div>
              <p className="text-white/40 text-sm mb-4">
                Launch a campaign on the world&apos;s biggest internet billboard.
              </p>
              <Link
                href="/advertise"
                className="inline-flex items-center gap-2 bg-green-400 hover:bg-green-300 text-black font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                Rent Tiles →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
