'use client'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'

function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffH = diffMs / 3600000
  if (diffH < 0) return 'overdue'
  if (diffH < 1) return `${Math.round(diffH * 60)}m`
  if (diffH < 24) return `${Math.round(diffH)}h`
  return `${Math.round(diffH / 24)}d`
}

interface DashboardAd {
  id: string
  destinationDomain: string
  tileCount: number
  displayMode: string
  dailyRate: number
  status: string
  activatedAt: string | null
  nextBillingAt: string | null
}

interface DashboardData {
  balance: number
  walletAddress: string | null
  activeAdsCount: number
  pendingAdsCount: number
  activeTiles: number
  dailyBurn: number
  runwayDays: number | null
  nextBillingAt: string | null
  ads: DashboardAd[]
}

export default function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet()
  const { setVisible } = useWalletModal()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user/dashboard')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Clear stale dashboard data and close dropdown on wallet disconnect or switch
  useEffect(() => {
    setData(null)
    setOpen(false)
  }, [publicKey])

  useEffect(() => {
    if (open && publicKey) fetchDashboard()
  }, [open, publicKey, fetchDashboard])

  if (!publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        disabled={connecting}
        className="ml-2 bg-green-400 hover:bg-green-300 disabled:opacity-50 text-black text-xs font-bold px-3 py-1.5 rounded transition-colors"
      >
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
    )
  }

  const lowBalance = data && data.balance === 0 && data.activeAdsCount > 0
  const runwayCritical = data && data.runwayDays !== null && data.runwayDays < 1 && data.activeAdsCount > 0
  const showWarning = lowBalance || runwayCritical
  const visibleAds = data?.ads.slice(0, 3) ?? []
  const hasMore = (data?.ads.length ?? 0) > 3

  return (
    <div ref={ref} className="relative ml-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`border text-xs font-bold px-3 py-1.5 rounded transition-colors font-mono ${
          showWarning
            ? 'bg-red-400/10 hover:bg-red-400/20 border-red-400/30 text-red-400'
            : 'bg-green-400/10 hover:bg-green-400/20 border-green-400/30 text-green-400'
        }`}
      >
        {shorten(publicKey.toBase58())}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-black border border-white/10 rounded-xl shadow-2xl z-50 w-72">
          {/* Address */}
          <div className="px-4 py-3 border-b border-white/5">
            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-0.5">Connected wallet</div>
            <div className="text-white/60 text-xs font-mono truncate">{publicKey.toBase58()}</div>
          </div>

          {loading && !data ? (
            <div className="px-4 py-6 text-center text-white/30 text-xs animate-pulse">Loading…</div>
          ) : data ? (
            <>
              {/* Balance + stats */}
              <div className="px-4 py-3 border-b border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/40 text-[10px] uppercase tracking-widest">Balance</span>
                  <span className={`font-mono font-bold text-sm ${data.balance === 0 ? 'text-white/40' : 'text-green-400'}`}>
                    ${data.balance.toFixed(2)} USDC
                  </span>
                </div>

                {showWarning && (
                  <div className="text-red-400 text-[10px] bg-red-400/10 rounded px-2 py-1">
                    {lowBalance
                      ? 'Balance low. Top up to keep ads live.'
                      : 'Less than 1 day runway.'}
                  </div>
                )}

                {data.activeAdsCount > 0 ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-white/30">Active ads</span>
                      <span className="text-white font-mono">{data.activeAdsCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/30">Tiles rented</span>
                      <span className="text-white font-mono">{data.activeTiles}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/30">Daily burn</span>
                      <span className="text-white font-mono">${data.dailyBurn.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/30">Runway</span>
                      <span className={`font-mono ${runwayCritical ? 'text-red-400' : data.runwayDays !== null && data.runwayDays < 3 ? 'text-amber-400' : 'text-white'}`}>
                        {data.runwayDays !== null ? `${Math.floor(data.runwayDays)}d` : '∞'}
                      </span>
                    </div>
                    {data.nextBillingAt && (
                      <div className="flex items-center justify-between col-span-2">
                        <span className="text-white/30">Next billing</span>
                        <span className="text-white/60 font-mono">{fmtDate(data.nextBillingAt)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-white/25 text-[10px]">No active spend</div>
                )}

                {data.pendingAdsCount > 0 && (
                  <div className="text-amber-400/70 text-[10px]">
                    {data.pendingAdsCount} ad{data.pendingAdsCount !== 1 ? 's' : ''} pending approval
                  </div>
                )}
              </div>

              {/* Active ads list */}
              {visibleAds.length > 0 && (
                <div className="px-4 py-2 border-b border-white/5 space-y-1.5">
                  <div className="text-[10px] text-white/25 uppercase tracking-widest mb-1">Active ads</div>
                  {visibleAds.map((ad) => (
                    <div key={ad.id} className="flex items-center justify-between gap-2 text-[10px]">
                      <div className="min-w-0 flex-1">
                        <div className="text-white/70 font-medium truncate">{ad.destinationDomain}</div>
                        <div className="text-white/30 font-mono">
                          {ad.tileCount} tile{ad.tileCount !== 1 ? 's' : ''} · {ad.displayMode === 'STRETCH' ? 'Stretch' : 'Repeat'} · ${ad.dailyRate.toFixed(2)}/day
                        </div>
                      </div>
                      {ad.nextBillingAt && (
                        <div className="text-white/25 font-mono flex-shrink-0">{fmtDate(ad.nextBillingAt)}</div>
                      )}
                    </div>
                  ))}
                  {hasMore && (
                    <Link
                      href="/advertise"
                      onClick={() => setOpen(false)}
                      className="text-[10px] text-green-400/60 hover:text-green-400 transition-colors"
                    >
                      View all {data!.ads.length} ads →
                    </Link>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="p-3 space-y-1.5">
                <Link
                  href="/advertise"
                  onClick={() => setOpen(false)}
                  className="block w-full text-center bg-green-400/10 hover:bg-green-400/20 border border-green-400/20 text-green-400 text-xs font-bold py-2 rounded-lg transition-colors"
                >
                  {data.activeAdsCount === 0 ? 'Advertise' : 'Top Up / Advertise More'}
                </Link>
                <button
                  onClick={() => { disconnect(); setOpen(false) }}
                  className="w-full text-center bg-white/3 hover:bg-white/8 border border-white/10 text-white/40 hover:text-red-400 text-xs py-2 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <div className="px-4 py-3">
              <button
                onClick={() => { disconnect(); setOpen(false) }}
                className="w-full text-left text-xs text-red-400 hover:bg-white/5 px-0 py-1 transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
