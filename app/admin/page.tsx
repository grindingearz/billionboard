'use client'

import { useState, useEffect, useCallback } from 'react'

type AdminView = 'pending' | 'active' | 'billing' | 'epochs'

interface Rental {
  id: string
  tileId: number
  status: string
  createdAt: string
  startDate: string | null
  dailyRate: number
  creative: { imageUrl: string; destUrl: string; altText: string | null } | null
  user: { email: string | null; walletAddress: string | null }
}

interface BillingRun {
  id: string
  runDate: string
  tilesCharged: number
  totalRevenue: string
  status: string
}

interface Epoch {
  id: string
  epochDate: string
  totalPool: string
  status: string
  snapshotDate: string | null
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [view, setView] = useState<AdminView>('pending')
  const [rentals, setRentals] = useState<Rental[]>([])
  const [billingRuns, setBillingRuns] = useState<BillingRun[]>([])
  const [epochs, setEpochs] = useState<Epoch[]>([])
  const [loading, setLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [billingRunning, setBillingRunning] = useState(false)
  const [epochForm, setEpochForm] = useState({ totalPool: '' })
  const [snapshotForm, setSnapshotForm] = useState({ epochId: '', wallets: '' })

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password }),
    })
    if (res.ok) {
      setAuthed(true)
      setAuthError('')
    } else {
      setAuthError('Invalid password')
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    if (view === 'pending' || view === 'active') {
      const res = await fetch(`/api/admin?view=${view}`)
      if (res.ok) {
        const d = await res.json()
        setRentals(d.rentals ?? [])
      }
    } else if (view === 'billing') {
      const res = await fetch('/api/admin?view=billing')
      if (res.ok) {
        const d = await res.json()
        setBillingRuns(d.runs ?? [])
      }
    } else if (view === 'epochs') {
      const res = await fetch('/api/admin?view=epochs')
      if (res.ok) {
        const d = await res.json()
        setEpochs(d.epochs ?? [])
      }
    }
    setLoading(false)
  }, [view])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  const act = async (action: string, extra: Record<string, string> = {}) => {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    const d = await res.json()
    if (res.ok) {
      setActionMsg('Done ✓')
      setTimeout(() => setActionMsg(''), 2000)
      load()
    } else {
      setActionMsg(d.error ?? 'Error')
    }
  }

  const runBilling = async () => {
    setBillingRunning(true)
    const res = await fetch('/api/billing', { method: 'POST' })
    const d = await res.json()
    setBillingRunning(false)
    if (res.ok) {
      setActionMsg(`Billing done: ${d.tilesCharged} tiles, $${d.totalRevenue}`)
    } else {
      setActionMsg(d.error ?? 'Billing failed')
    }
    if (view === 'billing') load()
  }

  const createEpoch = async (e: React.FormEvent) => {
    e.preventDefault()
    await act('create_epoch', { totalPool: epochForm.totalPool })
    setEpochForm({ totalPool: '' })
  }

  const submitSnapshot = async (e: React.FormEvent) => {
    e.preventDefault()
    // Parse "wallet:balance" lines as mock holder data
    const mockHolders = snapshotForm.wallets
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [wallet, balance] = line.split(':')
        return { wallet: wallet.trim(), balance: parseFloat(balance?.trim() ?? '0') }
      })
      .filter((h) => h.wallet && !isNaN(h.balance))

    await act('snapshot_epoch', {
      epochId: snapshotForm.epochId,
      mockHolders: JSON.stringify(mockHolders),
    })
    setSnapshotForm({ epochId: '', wallets: '' })
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-xs">
          <h1 className="text-xl font-black text-amber-400 mb-4">Admin</h1>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-amber-400"
            />
            {authError && <p className="text-red-400 text-xs">{authError}</p>}
            <button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-2.5 rounded-lg text-sm transition-colors"
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black text-amber-400">Admin Dashboard</h1>
        {actionMsg && (
          <span className="text-sm text-green-400 bg-green-400/10 px-3 py-1 rounded">{actionMsg}</span>
        )}
        <button
          onClick={runBilling}
          disabled={billingRunning}
          className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-xs font-bold px-4 py-2 rounded transition-colors disabled:opacity-50"
        >
          {billingRunning ? 'Running…' : '▶ Run daily billing'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-0">
        {(['pending', 'active', 'billing', 'epochs'] as AdminView[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              view === v
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-white/40 hover:text-white'
            }`}
          >
            {v === 'pending' ? 'Pending Approval' : v === 'active' ? 'Active Rentals' : v === 'billing' ? 'Billing Runs' : 'Epochs'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-white/30 text-sm animate-pulse">Loading…</div>
      ) : (
        <>
          {(view === 'pending' || view === 'active') && (
            <div className="space-y-3">
              {rentals.length === 0 ? (
                <div className="text-white/30 text-sm text-center py-12">
                  {view === 'pending' ? 'No pending ads.' : 'No active rentals.'}
                </div>
              ) : (
                rentals.map((r) => (
                  <div
                    key={r.id}
                    className="border border-white/10 rounded-xl p-4 bg-white/2 flex gap-4"
                  >
                    {r.creative?.imageUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={r.creative.imageUrl}
                        alt={r.creative.altText ?? 'Ad'}
                        className="w-20 h-20 object-cover rounded border border-white/10 flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-white font-mono text-sm">Tile #{r.tileId}</div>
                          <div className="text-white/40 text-xs truncate">
                            {r.user.email ?? r.user.walletAddress ?? 'unknown'}
                          </div>
                          {r.creative?.destUrl && (
                            <a
                              href={r.creative.destUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-green-400 hover:text-green-300 truncate block max-w-xs"
                            >
                              {r.creative.destUrl}
                            </a>
                          )}
                          <div className="text-white/30 text-xs mt-1">
                            {new Date(r.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {view === 'pending' && (
                            <>
                              <button
                                onClick={() => act('approve', { rentalId: r.id })}
                                className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 text-xs px-3 py-1.5 rounded transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => act('reject', { rentalId: r.id })}
                                className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 text-xs px-3 py-1.5 rounded transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {view === 'active' && (
                            <button
                              onClick={() => act('expire', { rentalId: r.id })}
                              className="bg-white/5 hover:bg-white/10 border border-white/20 text-white/60 text-xs px-3 py-1.5 rounded transition-colors"
                            >
                              Expire
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {view === 'billing' && (
            <div>
              {billingRuns.length === 0 ? (
                <div className="text-white/30 text-sm text-center py-12">
                  No billing runs yet. Click &quot;Run daily billing&quot; above.
                </div>
              ) : (
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
                    {billingRuns.map((r) => (
                      <tr key={r.id} className="border-b border-white/5">
                        <td className="py-3 text-white/70">{new Date(r.runDate).toLocaleDateString()}</td>
                        <td className="py-3 text-right font-mono text-white/70">{r.tilesCharged}</td>
                        <td className="py-3 text-right font-mono text-green-400">
                          ${Number(r.totalRevenue).toFixed(2)}
                        </td>
                        <td className="py-3 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            r.status === 'completed' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400'
                          }`}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {view === 'epochs' && (
            <div className="space-y-6">
              {/* Create epoch form */}
              <div className="border border-white/10 rounded-xl p-5 bg-white/2">
                <h3 className="text-sm font-bold text-white mb-3">Create new epoch</h3>
                <form onSubmit={createEpoch} className="flex gap-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={epochForm.totalPool}
                    onChange={(e) => setEpochForm({ totalPool: e.target.value })}
                    placeholder="Total pool (USDC)"
                    className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={!epochForm.totalPool}
                    className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-sm px-4 py-2 rounded transition-colors disabled:opacity-50"
                  >
                    Create
                  </button>
                </form>
              </div>

              {/* Mock snapshot form */}
              <div className="border border-white/10 rounded-xl p-5 bg-white/2">
                <h3 className="text-sm font-bold text-white mb-1">Mock holder snapshot</h3>
                <p className="text-white/30 text-xs mb-3">
                  Enter wallets as &quot;wallet_address:token_balance&quot; per line.
                  {/* TODO: replace with real Solana token holder indexing */}
                </p>
                <form onSubmit={submitSnapshot} className="space-y-3">
                  <input
                    value={snapshotForm.epochId}
                    onChange={(e) => setSnapshotForm((f) => ({ ...f, epochId: e.target.value }))}
                    placeholder="Epoch ID"
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-400"
                  />
                  <textarea
                    value={snapshotForm.wallets}
                    onChange={(e) => setSnapshotForm((f) => ({ ...f, wallets: e.target.value }))}
                    placeholder={'9xYz…wallet1:1000000\n7aBC…wallet2:500000'}
                    rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={!snapshotForm.epochId}
                    className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-xs px-4 py-2 rounded transition-colors disabled:opacity-50"
                  >
                    Take snapshot
                  </button>
                </form>
              </div>

              {/* Epoch list */}
              {epochs.length > 0 && (
                <div className="space-y-2">
                  {epochs.map((ep) => (
                    <div
                      key={ep.id}
                      className="border border-white/10 rounded-xl p-4 bg-white/2 flex items-center justify-between"
                    >
                      <div>
                        <div className="text-white text-sm">
                          {new Date(ep.epochDate).toLocaleDateString()}
                        </div>
                        <div className="text-white/40 text-xs font-mono">{ep.id}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-green-400">
                          ${Number(ep.totalPool).toFixed(2)}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            ep.status === 'PUBLISHED'
                              ? 'bg-green-400/10 text-green-400'
                              : 'bg-amber-400/10 text-amber-400'
                          }`}
                        >
                          {ep.status}
                        </span>
                        {ep.status !== 'PUBLISHED' && ep.status !== 'CLOSED' && (
                          <button
                            onClick={() => act('publish_epoch', { epochId: ep.id })}
                            className="text-xs bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 px-3 py-1 rounded transition-colors"
                          >
                            Publish
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
