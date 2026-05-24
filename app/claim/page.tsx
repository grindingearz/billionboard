'use client'

import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'

interface ClaimableItem {
  epochId: string
  amount: string
  claimAmount?: string  // legacy field
  tokenBalance: number | null
  sharePercent: number | null
  distributionFunded: boolean
  epoch: { epochDate: string; status: string; id: string }
  isLegacy?: boolean
}

interface HistoryClaim {
  epochId: string
  amount: string
  status: string
  claimedAt: string | null
  txHash: string | null
  epoch: { epochDate: string }
}

interface ClaimData {
  wallet: string
  excluded: boolean
  claimable: ClaimableItem[]
  claims: HistoryClaim[]
  payoutActive: boolean
  tokenBalance: null
}

const BOARD_MINT = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''

function epochDateLabel(iso: string) {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} UTC`
}

function getAmount(item: ClaimableItem): number {
  return Number(item.amount ?? item.claimAmount ?? 0)
}

export default function ClaimPage() {
  const { publicKey } = useWallet()
  const { setVisible: openWalletModal } = useWalletModal()
  const [data, setData] = useState<ClaimData | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState('')
  const sessionCreatedFor = useRef<string | null>(null)

  const walletAddr = publicKey?.toBase58() ?? ''

  // Create an ADVERTISER session when the wallet connects (required for POST /api/claims)
  useEffect(() => {
    if (!walletAddr || sessionCreatedFor.current === walletAddr) return
    sessionCreatedFor.current = walletAddr
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: walletAddr }),
    }).catch(() => {/* session creation is best-effort */})
  }, [walletAddr])

  // Fetch claim data when wallet changes
  useEffect(() => {
    if (!walletAddr) { setData(null); return }
    setLoading(true)
    setError('')
    fetch(`/api/claims?wallet=${encodeURIComponent(walletAddr)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError('Lookup failed'))
      .finally(() => setLoading(false))
  }, [walletAddr])

  const refreshData = () => {
    if (!walletAddr) return
    fetch(`/api/claims?wallet=${encodeURIComponent(walletAddr)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => {})
  }

  const claim = async (epochId: string) => {
    setClaiming(epochId)
    setError('')
    const res = await fetch('/api/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epochId }),
    })
    const d = await res.json()
    if (res.ok || res.status === 202) {
      refreshData()
    } else {
      setError(d.error ?? 'Claim failed')
    }
    setClaiming(null)
  }

  const claimAll = async () => {
    if (!data?.claimable.length) return
    for (const item of data.claimable) {
      setClaiming(item.epochId)
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epochId: item.epochId }),
      })
      if (!res.ok && res.status !== 202) {
        const d = await res.json()
        setError(d.error ?? 'Claim failed')
        break
      }
    }
    setClaiming(null)
    refreshData()
  }

  const totalClaimable = data?.claimable.reduce((s, c) => s + getAmount(c), 0) ?? 0
  const payoutActive = data?.payoutActive ?? false

  return (
    <div className="min-h-screen max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-black text-white mb-1">Claim Revenue</h1>
      <p className="text-white/40 text-sm mb-8">
        $BOARD holders earn a pro-rata share of daily billboard revenue.
      </p>

      {/* Pre-token banner */}
      {!BOARD_MINT && (
        <div className="border border-amber-400/20 bg-amber-400/5 rounded-xl p-4 mb-8">
          <div className="text-xs text-amber-400/70 uppercase tracking-widest mb-1">Token launch pending</div>
          <div className="text-white font-bold">$BOARD claims activate after token launch.</div>
          <div className="text-white/40 text-sm mt-1">
            Once $BOARD is live on Solana, your token balance will determine your share of daily revenue.
          </div>
        </div>
      )}

      {/* Payout pending banner */}
      {BOARD_MINT && !payoutActive && data && (
        <div className="border border-white/10 bg-white/3 rounded-xl p-4 mb-8">
          <div className="text-xs text-white/40 uppercase tracking-widest mb-1">Payouts pending</div>
          <div className="text-white font-bold">Claims are prepared. Payout activation pending.</div>
          <div className="text-white/40 text-sm mt-1">
            You can register your claim now — USDC will be sent once the distribution wallet is activated.
          </div>
        </div>
      )}

      {/* Wallet connect / status */}
      {!publicKey ? (
        <div className="border border-white/10 rounded-xl p-6 bg-white/2 text-center mb-8">
          <p className="text-white/50 text-sm mb-4">Connect your wallet to check your claimable balance.</p>
          <button
            onClick={() => openWalletModal(true)}
            className="bg-green-400 hover:bg-green-300 text-black font-bold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-8 text-sm">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          <span className="font-mono text-white/70">
            {walletAddr.slice(0, 6)}…{walletAddr.slice(-4)}
          </span>
          {loading && <span className="text-white/30 text-xs animate-pulse">checking…</span>}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {data?.excluded && (
        <div className="bg-amber-900/30 border border-amber-500/30 rounded-lg p-3 text-amber-400 text-sm mb-4">
          This wallet has been excluded from distributions.
        </div>
      )}

      {data && !data.excluded && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="border border-white/10 rounded-xl p-4 bg-white/2">
              <div className="text-xs text-white/40 uppercase tracking-widest mb-1">$BOARD Balance</div>
              {data.claimable[0]?.tokenBalance != null ? (
                <>
                  <div className="text-2xl font-black text-white">
                    {data.claimable[0].tokenBalance.toLocaleString()}
                  </div>
                  {data.claimable[0].sharePercent != null && (
                    <div className="text-xs text-white/30 mt-1">
                      {data.claimable[0].sharePercent.toFixed(4)}% of eligible supply
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-2xl font-black text-white/30">—</div>
                  <div className="text-xs text-white/25 mt-1">
                    {BOARD_MINT ? 'No snapshot yet' : 'Token launch pending'}
                  </div>
                </>
              )}
            </div>
            <div className="border border-green-400/20 bg-green-400/5 rounded-xl p-4">
              <div className="text-xs text-green-400/70 uppercase tracking-widest mb-1">Claimable USDC</div>
              <div className="text-2xl font-black text-green-400">${totalClaimable.toFixed(2)}</div>
              <div className="text-xs text-white/25 mt-1">
                {data.claimable.length} epoch{data.claimable.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Claimable epochs */}
          {data.claimable.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">Ready to claim</h3>
                {data.claimable.length > 1 && (
                  <button
                    onClick={claimAll}
                    disabled={!!claiming}
                    className="text-xs bg-green-400/10 border border-green-400/20 text-green-400 hover:bg-green-400/20 px-3 py-1 rounded transition-colors disabled:opacity-50"
                  >
                    Claim all
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {data.claimable.map((s) => (
                  <div
                    key={s.epochId}
                    className="flex items-center justify-between border border-green-400/20 bg-green-400/5 rounded-lg px-4 py-3"
                  >
                    <div>
                      <div className="text-sm text-white font-medium">
                        {epochDateLabel(s.epoch.epochDate)}
                      </div>
                      <div className="text-xs text-white/40">
                        {s.tokenBalance != null
                          ? `${s.tokenBalance.toLocaleString()} tokens${s.sharePercent != null ? ` · ${s.sharePercent.toFixed(4)}%` : ''}`
                          : 'Epoch distribution'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-green-400 font-mono font-bold">
                        ${getAmount(s).toFixed(4)}
                      </span>
                      {payoutActive ? (
                        <button
                          onClick={() => claim(s.epochId)}
                          disabled={!!claiming}
                          className="bg-green-400 hover:bg-green-300 disabled:opacity-50 text-black font-bold px-3 py-1.5 rounded text-xs transition-colors"
                        >
                          {claiming === s.epochId ? '…' : 'Claim'}
                        </button>
                      ) : (
                        <button
                          onClick={() => claim(s.epochId)}
                          disabled={!!claiming}
                          className="bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white/60 font-bold px-3 py-1.5 rounded text-xs transition-colors"
                          title="Payout not active yet — registers your claim for when it activates"
                        >
                          {claiming === s.epochId ? '…' : 'Register'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Claim history */}
          {data.claims.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-white mb-3">Claim history</h3>
              <div className="space-y-1.5">
                {data.claims.map((c) => (
                  <div
                    key={`${c.epochId}-${c.status}`}
                    className="flex items-center justify-between px-4 py-2.5 bg-white/3 rounded-lg border border-white/5"
                  >
                    <div className="text-sm text-white/60">{epochDateLabel(c.epoch.epochDate)}</div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-white">${Number(c.amount).toFixed(4)}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          c.status === 'CLAIMED'
                            ? 'bg-green-400/10 text-green-400'
                            : c.status === 'PENDING'
                              ? 'bg-amber-400/10 text-amber-400'
                              : 'bg-red-400/10 text-red-400'
                        }`}
                      >
                        {c.status}
                      </span>
                      {c.txHash && (
                        <a
                          href={`https://solscan.io/tx/${c.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white/20 text-xs font-mono hover:text-white/50 transition-colors"
                        >
                          {c.txHash.slice(0, 8)}… ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.claimable.length === 0 && data.claims.length === 0 && (
            <div className="text-center text-white/30 py-12">
              No claimable epochs found for this wallet.
            </div>
          )}
        </>
      )}

      {/* Info */}
      <div className="mt-10 border border-white/10 rounded-xl p-5 bg-white/2">
        <h3 className="text-sm font-bold text-white mb-2">How claims work</h3>
        <ul className="text-sm text-white/50 space-y-1">
          <li>• Each day&apos;s billboard revenue is added to the claim pool</li>
          <li>• A snapshot of all $BOARD holders is taken daily</li>
          <li>• Your share = your tokens ÷ total eligible supply × daily pool</li>
          <li>• Claims are distributed in USDC on Solana</li>
          <li>• System wallets are excluded from distributions</li>
          <li>• Selling tokens after the snapshot does not affect your claim</li>
        </ul>
      </div>
    </div>
  )
}
