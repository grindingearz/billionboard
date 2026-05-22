'use client'

import { useEffect, useState } from 'react'
import { tileIdToCoords } from '@/lib/types'

interface TilePanelProps {
  tileId: number | null
  onClose: () => void
  onSelectForRental?: (tileId: number) => void
}

interface TileDetail {
  tileId: number
  col: number
  row: number
  status: 'AVAILABLE' | 'PENDING' | 'ACTIVE' | 'EXPIRED'
  rental: {
    id: string
    destUrl: string | null
    imageUrl: string | null
    altText: string | null
    dailyRate: number
    startDate: string | null
  } | null
}

export default function TilePanel({ tileId, onClose, onSelectForRental }: TilePanelProps) {
  const [detail, setDetail] = useState<TileDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (tileId === null) { setDetail(null); return }
    setLoading(true)
    fetch(`/api/tiles/${tileId}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tileId])

  if (tileId === null) return null

  const { col, row } = tileIdToCoords(tileId)

  const statusColor = {
    AVAILABLE: 'text-white',
    PENDING: 'text-amber-400',
    ACTIVE: 'text-green-400',
    EXPIRED: 'text-gray-500',
  }[detail?.status ?? 'AVAILABLE']

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-[#0a0a0a] border-l border-white/10 z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div>
          <div className="text-xs text-white/40 uppercase tracking-widest">Tile</div>
          <div className="text-white font-mono text-lg">
            #{tileId}&nbsp;
            <span className="text-white/30 text-sm">
              ({col}, {row})
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors text-xl leading-none">
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading ? (
          <div className="text-white/30 text-sm animate-pulse">Loading…</div>
        ) : detail ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-current" style={{ color: undefined }} />
              <span className={`text-sm font-medium ${statusColor}`}>{detail.status}</span>
            </div>

            {detail.status === 'ACTIVE' && detail.rental?.imageUrl && (
              <div className="rounded overflow-hidden border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detail.rental.imageUrl}
                  alt={detail.rental.altText ?? 'Ad'}
                  className="w-full object-cover"
                />
              </div>
            )}

            {detail.rental?.destUrl && (
              <a
                href={detail.rental.destUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-green-400 hover:text-green-300 truncate"
              >
                {detail.rental.destUrl}
              </a>
            )}

            <div className="text-xs text-white/40 space-y-1">
              <div>
                Daily rate: <span className="text-white/70">$1.00 USDC</span>
              </div>
              {detail.rental?.startDate && (
                <div>
                  Active since:{' '}
                  <span className="text-white/70">
                    {new Date(detail.rental.startDate).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Footer CTA */}
      {detail?.status === 'AVAILABLE' && onSelectForRental && (
        <div className="px-5 py-4 border-t border-white/10">
          <button
            onClick={() => { onSelectForRental(tileId); onClose() }}
            className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-2.5 rounded text-sm transition-colors"
          >
            Rent this tile — $1/day
          </button>
        </div>
      )}
    </div>
  )
}
