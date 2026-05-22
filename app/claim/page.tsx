'use client'

import { useState } from 'react'

interface Snapshot {
  epochId: string
  claimAmount: string
  epoch: { epochDate: string; status: string }
}

interface Claim {
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
  claimable: Snapshot[]
  claims: Claim[]
  tokenBalance: null
}

export default function ClaimPage() {
  const [wallet, setWallet] = useState('')
  const [data, setData] = useState<ClaimData | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState('')

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch(`/api/claims?wallet=${encodeURIComponent(wallet)}`)
    if (res.ok) {
      setData(await res.json())
    } else {
      setError('Lookup failed')
    }
    setLoading(false)
  }

  const claim = async (epochId: string) => {
    setClaiming(epochId)
    const res = await fetch('/api/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, epochId }),
    })
    const d = await res.json()
    if (res.ok) {
      // Refresh
      const r2 = await fetch(`/api/claims?wallet=${encodeURIComponent(wallet)}`)
      if (r2.ok) setData(await r2.json())
    } else {
      setError(d.error ?? 'Claim failed')
    }
    setClaiming(null)
  }

  const totalClaimable = data?.claimable.reduce((s, c) => s + Number(c.claimAmount), 0) ?? 0

  return (
    <div className="min-h-screen max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-black text-white mb-1">Claim Revenue</h1>
      <p className="text-white/40 text-sm mb-8">
        $BOARD holders earn a pro-rata share of daily billboard revenue. Connect your wallet to see
        your claimable balance.
      </p>

      {/* Wallet input */}
      <form onSubmit={lookup} className="flex gap-2 mb-8">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Solana wallet address…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-green-400 font-mono"
        />
        <button
          type="submit"
          disabled={!wallet || loading}
          className="bg-green-400 hover:bg-green-300 disabled:opacity-40 text-black font-bold px-5 py-3 rounded-lg text-sm transition-colors"
        >
          {loading ? '…' : 'Check'}
        </button>
      </form>

      {/* TODO: replace above with real Privy/Phantom wallet connect */}
      <p className="text-white/20 text-xs -mt-6 mb-8">
        Real wallet connect coming after $BOARD token launch on Solana.
      </p>

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
          {/* Token balance (placeholder) */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="border border-white/10 rounded-xl p-4 bg-white/2">
              <div className="text-xs text-white/40 uppercase tracking-widest mb-1">$BOARD Balance</div>
              <div className="text-2xl font-black text-white">
                {/* TODO: real token balance from Solana RPC */}
                <span className="text-white/30">—</span>
              </div>
              <div className="text-xs text-white/25 mt-1">Token launch pending</div>
            </div>
            <div className="border border-green-400/20 bg-green-400/5 rounded-xl p-4">
              <div className="text-xs text-green-400/70 uppercase tracking-widest mb-1">
                Claimable USDC
              </div>
              <div className="text-2xl font-black text-green-400">
                ${totalClaimable.toFixed(2)}
              </div>
              <div className="text-xs text-white/25 mt-1">
                {data.claimable.length} epoch{data.claimable.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Claimable epochs */}
          {data.claimable.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-white mb-3">Ready to claim</h3>
              <div className="space-y-2">
                {data.claimable.map((s) => (
                  <div
                    key={s.epochId}
                    className="flex items-center justify-between border border-green-400/20 bg-green-400/5 rounded-lg px-4 py-3"
                  >
                    <div>
                      <div className="text-sm text-white font-medium">
                        {new Date(s.epoch.epochDate).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-white/40">Epoch distribution</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-green-400 font-mono font-bold">
                        ${Number(s.claimAmount).toFixed(4)}
                      </span>
                      <button
                        onClick={() => claim(s.epochId)}
                        disabled={claiming === s.epochId}
                        className="bg-green-400 hover:bg-green-300 disabled:opacity-50 text-black font-bold px-3 py-1.5 rounded text-xs transition-colors"
                      >
                        {claiming === s.epochId ? '…' : 'Claim'}
                      </button>
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
                    <div className="text-sm text-white/60">
                      {new Date(c.epoch.epochDate).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-white">${Number(c.amount).toFixed(4)}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          c.status === 'CLAIMED'
                            ? 'bg-green-400/10 text-green-400'
                            : 'bg-red-400/10 text-red-400'
                        }`}
                      >
                        {c.status}
                      </span>
                      {c.txHash && (
                        <span className="text-white/20 text-xs font-mono truncate max-w-20">
                          {/* TODO: link to Solana explorer */}
                          {c.txHash.slice(0, 8)}…
                        </span>
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

      {/* Info box */}
      <div className="mt-10 border border-white/10 rounded-xl p-5 bg-white/2">
        <h3 className="text-sm font-bold text-white mb-2">How claims work</h3>
        <ul className="text-sm text-white/50 space-y-1">
          <li>• Each day&apos;s billboard revenue is added to the claim pool</li>
          <li>• A snapshot of all $BOARD holders is taken daily</li>
          <li>• Your share = your tokens ÷ total supply × daily pool</li>
          <li>• Claims are distributed in USDC on Solana</li>
          {/* TODO: add real $BOARD mint address once launched */}
        </ul>
      </div>
    </div>
  )
}
