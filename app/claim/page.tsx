'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'

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
  payoutActive: boolean
  tokenBalance: null
}

const BOARD_MINT = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''

export default function ClaimPage() {
  const { publicKey } = useWallet()
  const { setVisible: openWalletModal } = useWalletModal()
  const [data, setData] = useState<ClaimData | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState('')

  const walletAddr = publicKey?.toBase58() ?? ''

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

  const claim = async (epochId: string) => {
    setClaiming(epochId)
    setError('')
    const res = await fetch('/api/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: walletAddr, epochId }),
    })
    const d = await res.json()
    if (res.ok) {
      const r2 = await fetch(`/api/claims?wallet=${encodeURIComponent(walletAddr)}`)
      if (r2.ok) setData(await r2.json())
    } else {
      setError(d.error ?? 'Claim failed')
    }
    setClaiming(null)
  }

  const totalClaimable = data?.claimable.reduce((s, c) => s + Number(c.claimAmount), 0) ?? 0
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

      {/* Payout pending banner (token exists but private key not configured) */}
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
              <div className="text-2xl font-black text-white/30">—</div>
              <div className="text-xs text-white/25 mt-1">
                {BOARD_MINT ? 'Loading…' : 'Token launch pending'}
              </div>
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
              <h3 className="text-sm font-bold text-white mb-3">Ready to claim</h3>
              <div className="space-y-2">
                {data.claimable.map((s) => (
                  <div
                    key={s.epochId}
                    className="flex items-center justify-between border border-green-400/20 bg-green-400/5 rounded-lg px-4 py-3"
                  >
                    <div>
                      <div className="text-sm text-white font-medium">
                        {(() => { const d = new Date(s.epoch.epochDate); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} UTC` })()}
                      </div>
                      <div className="text-xs text-white/40">Epoch distribution</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-green-400 font-mono font-bold">
                        ${Number(s.claimAmount).toFixed(4)}
                      </span>
                      {payoutActive ? (
                        <button
                          onClick={() => claim(s.epochId)}
                          disabled={claiming === s.epochId}
                          className="bg-green-400 hover:bg-green-300 disabled:opacity-50 text-black font-bold px-3 py-1.5 rounded text-xs transition-colors"
                        >
                          {claiming === s.epochId ? '…' : 'Claim'}
                        </button>
                      ) : (
                        <button
                          onClick={() => claim(s.epochId)}
                          disabled={claiming === s.epochId}
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
                    <div className="text-sm text-white/60">
                      {(() => { const d = new Date(c.epoch.epochDate); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} UTC` })()}
                    </div>
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
        </ul>
      </div>
    </div>
  )
}
