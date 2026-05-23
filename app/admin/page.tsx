'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'

type AdminView = 'pending' | 'active' | 'billing' | 'epochs' | 'pricing' | 'topups' | 'reset'

interface ResetState {
  userId: string | null
  balance: number
  pendingTopups: number
  confirmedTopups: number
  activeRentals: number
  pendingRentals: number
}

interface PricingSettings {
  tile_price_usd_per_day: string
  free_rental_enabled: string
  free_rental_days: string
  management_fee_percent: string
}

interface Rental {
  id: string
  tileId: number
  status: string
  createdAt: string
  startDate: string | null
  dailyRate: number
  creative: { imageUrl: string | null; destUrl: string; altText: string | null; displayMode: string } | null
  user: { email: string | null; walletAddress: string | null }
}

interface RentalOrder {
  creativeId: string | null
  userId: string
  tileIds: number[]
  rentalIds: string[]
  tileCount: number
  status: string
  createdAt: string
  dailyRateTotal: number
  creative: { imageUrl: string | null; destUrl: string; altText: string | null; displayMode: string } | null
  user: { email: string | null; walletAddress: string | null }
  blockCols?: number
  blockRows?: number
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

interface TopupRecord {
  id: string
  userId: string
  status: string
  method: string
  amount: string
  actualAmount: string | null
  advertiserWallet: string | null
  depositWallet: string | null
  txSignature: string | null
  confirmedAt: string | null
  expiresAt: string | null
  createdAt: string
  user: { email: string | null }
}

interface UnmatchedTx {
  id: string
  signature: string
  amountUsdc: string
  senderWallet: string | null
  receiverWallet: string | null
  processedAt: string
  source: string
}

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET ?? ''

export default function AdminPage() {
  const { publicKey } = useWallet()
  const { setVisible: openWalletModal } = useWalletModal()
  const connectedAddress = publicKey?.toBase58() ?? ''
  const isAdminWallet = !!ADMIN_WALLET && connectedAddress === ADMIN_WALLET

  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [view, setView] = useState<AdminView>('pending')
  const [rentals, setRentals] = useState<Rental[]>([])
  const [pendingOrders, setPendingOrders] = useState<RentalOrder[]>([])
  const [approveAllConfirm, setApproveAllConfirm] = useState(false)
  const [rejectAllConfirm, setRejectAllConfirm] = useState(false)
  const [billingRuns, setBillingRuns] = useState<BillingRun[]>([])
  const [epochs, setEpochs] = useState<Epoch[]>([])
  const [loading, setLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [billingRunning, setBillingRunning] = useState(false)
  const [epochForm, setEpochForm] = useState({ totalPool: '' })
  const [snapshotForm, setSnapshotForm] = useState({ epochId: '', wallets: '' })
  const [topupData, setTopupData] = useState<{
    pending: TopupRecord[]
    confirmed: TopupRecord[]
    unmatched: UnmatchedTx[]
  }>({ pending: [], confirmed: [], unmatched: [] })
  const [topupSubview, setTopupSubview] = useState<'pending' | 'confirmed' | 'unmatched'>('pending')
  const [resetWallet, setResetWallet] = useState('')
  const [resetState, setResetState] = useState<ResetState | null>(null)
  const [resetConfirm1, setResetConfirm1] = useState(false)
  const [resetConfirm2, setResetConfirm2] = useState(false)
  const [fullBoardConfirm, setFullBoardConfirm] = useState('')
  const [resetting, setResetting] = useState(false)
  const defaultPricing: PricingSettings = {
    tile_price_usd_per_day: '1',
    free_rental_enabled: 'false',
    free_rental_days: '0',
    management_fee_percent: '10',
  }
  const [pricingForm, setPricingForm] = useState<PricingSettings>(defaultPricing)
  const [pricingSaving, setPricingSaving] = useState(false)

  // Revoke access when admin wallet disconnects or changes
  useEffect(() => {
    if (authed && !isAdminWallet) {
      setAuthed(false)
      setPassword('')
      setAuthError('')
    }
  }, [isAdminWallet, authed])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password, walletAddress: connectedAddress }),
    })
    if (res.ok) {
      setAuthed(true)
      setAuthError('')
    } else {
      const d = await res.json()
      setAuthError(d.error === 'WALLET_NOT_ADMIN' ? 'Wallet not authorized.' : 'Invalid password')
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    if (view === 'pending') {
      const res = await fetch('/api/admin?view=pending')
      if (res.ok) {
        const d = await res.json()
        setPendingOrders(d.orders ?? [])
        setApproveAllConfirm(false)
        setRejectAllConfirm(false)
      }
    } else if (view === 'active') {
      const res = await fetch('/api/admin?view=active')
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
    } else if (view === 'pricing') {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const d = await res.json()
        setPricingForm({ ...defaultPricing, ...d.settings })
      }
    } else if (view === 'topups') {
      const res = await fetch('/api/admin?view=topups')
      if (res.ok) {
        const d = await res.json()
        setTopupData({
          pending: d.pending ?? [],
          confirmed: d.confirmed ?? [],
          unmatched: d.unmatched ?? [],
        })
      }
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const savePricing = async (e: React.FormEvent) => {
    e.preventDefault()
    // Validate
    const price = parseFloat(pricingForm.tile_price_usd_per_day)
    const days = parseInt(pricingForm.free_rental_days, 10)
    const fee = parseFloat(pricingForm.management_fee_percent)
    if (isNaN(price) || price < 0) { setActionMsg('Price must be ≥ 0'); return }
    if (isNaN(days) || days < 0) { setActionMsg('Free days must be ≥ 0'); return }
    if (isNaN(fee) || fee < 0 || fee > 100) { setActionMsg('Fee must be 0–100'); return }

    setPricingSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pricingForm),
    })
    const d = await res.json()
    setPricingSaving(false)
    if (res.ok) {
      setPricingForm({ ...defaultPricing, ...d.settings })
      setActionMsg('Pricing saved ✓')
      setTimeout(() => setActionMsg(''), 3000)
    } else {
      setActionMsg(d.error ?? 'Error saving pricing')
    }
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

  const loadResetState = useCallback(async (wallet: string) => {
    if (!wallet) return
    const res = await fetch(`/api/admin?view=reset_state&walletAddress=${encodeURIComponent(wallet)}`)
    if (res.ok) {
      const d = await res.json()
      setResetState(d)
    }
  }, [])

  // Auto-load reset state when switching to reset view
  useEffect(() => {
    if (view === 'reset' && authed && connectedAddress) {
      setResetWallet(connectedAddress)
      loadResetState(connectedAddress)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, authed])

  const handleReset = async (action: string) => {
    setResetting(true)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, walletAddress: resetWallet }),
    })
    const d = await res.json()
    setResetting(false)
    if (res.ok) {
      setActionMsg(d.cleared !== undefined ? `Done — ${d.cleared} item(s) affected` : 'Done ✓')
      setTimeout(() => setActionMsg(''), 3000)
      setResetConfirm1(false)
      setResetConfirm2(false)
      loadResetState(resetWallet)
    } else {
      setActionMsg(d.error ?? 'Error')
    }
  }

  const handleClearFullBoard = async () => {
    setResetting(true)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_full_board', confirm: fullBoardConfirm }),
    })
    const d = await res.json()
    setResetting(false)
    if (res.ok) {
      setActionMsg(`Done — ${d.cleared} rental(s) expired`)
      setTimeout(() => setActionMsg(''), 3000)
      setFullBoardConfirm('')
      if (resetWallet) loadResetState(resetWallet)
    } else {
      setActionMsg(d.error ?? 'Error')
    }
  }

  if (!authed) {
    // Step 1: no wallet connected
    if (!publicKey) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-xs text-center">
            <h1 className="text-xl font-black text-amber-400 mb-4">Admin</h1>
            <p className="text-white/50 text-sm mb-6">Connect the admin wallet to continue.</p>
            <button
              onClick={() => openWalletModal(true)}
              className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      )
    }

    // Step 2: wrong wallet connected
    if (!isAdminWallet) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-xs text-center">
            <h1 className="text-xl font-black text-amber-400 mb-4">Admin</h1>
            <p className="text-red-400 text-sm mb-3">This wallet is not authorized for admin access.</p>
            <p className="text-white/20 text-xs font-mono">{connectedAddress.slice(0, 8)}…{connectedAddress.slice(-4)}</p>
          </div>
        </div>
      )
    }

    // Step 3: correct admin wallet — require password
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-xs">
          <h1 className="text-xl font-black text-amber-400 mb-1">Admin</h1>
          <div className="flex items-center gap-2 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            <span className="text-green-400/70 text-xs font-mono">
              {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}
            </span>
          </div>
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
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-0 flex-wrap">
        {(['pending', 'active', 'billing', 'epochs', 'pricing', 'topups', 'reset'] as AdminView[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              view === v
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-white/40 hover:text-white'
            }`}
          >
            {v === 'pending' ? 'Pending Approval'
              : v === 'active' ? 'Active Rentals'
              : v === 'billing' ? 'Billing Runs'
              : v === 'epochs' ? 'Epochs'
              : v === 'pricing' ? 'Pricing Settings'
              : v === 'topups' ? 'Top-ups'
              : 'Testing / Reset'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-white/30 text-sm animate-pulse">Loading…</div>
      ) : (
        <>
          {view === 'pending' && (
            <div className="space-y-3">
              {pendingOrders.length === 0 ? (
                <div className="text-white/30 text-sm text-center py-12">No pending ad orders.</div>
              ) : (
                <>
                  {/* Bulk action bar */}
                  <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-white/3 border border-white/10 rounded-xl">
                    <span className="text-xs text-white/50 flex-1 min-w-0">
                      <span className="text-white font-medium">{pendingOrders.length}</span> pending order{pendingOrders.length !== 1 ? 's' : ''} covering{' '}
                      <span className="text-white font-medium">{pendingOrders.reduce((s, o) => s + o.tileCount, 0)}</span> tiles
                    </span>
                    {approveAllConfirm ? (
                      <>
                        <span className="text-xs text-green-400/70">Approve all {pendingOrders.length} pending ad orders?</span>
                        <button
                          onClick={() => { act('approve_all_orders'); setApproveAllConfirm(false) }}
                          className="text-xs bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 px-3 py-1.5 rounded transition-colors"
                        >
                          Confirm
                        </button>
                        <button onClick={() => setApproveAllConfirm(false)} className="text-xs text-white/40 hover:text-white transition-colors">
                          Cancel
                        </button>
                      </>
                    ) : rejectAllConfirm ? (
                      <>
                        <span className="text-xs text-red-400/70">Reject all {pendingOrders.length} pending ad orders?</span>
                        <button
                          onClick={() => { act('reject_all_orders'); setRejectAllConfirm(false) }}
                          className="text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 px-3 py-1.5 rounded transition-colors"
                        >
                          Confirm
                        </button>
                        <button onClick={() => setRejectAllConfirm(false)} className="text-xs text-white/40 hover:text-white transition-colors">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setApproveAllConfirm(true)}
                          className="text-xs bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400/80 px-3 py-1.5 rounded transition-colors"
                        >
                          Approve All Pending Orders
                        </button>
                        <button
                          onClick={() => setRejectAllConfirm(true)}
                          className="text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400/60 px-3 py-1.5 rounded transition-colors"
                        >
                          Reject All
                        </button>
                      </>
                    )}
                  </div>

                  {/* Order cards */}
                  {pendingOrders.map((order) => (
                    <div
                      key={order.creativeId ?? order.rentalIds[0]}
                      className="border border-white/10 rounded-xl p-4 bg-white/2 flex gap-4"
                    >
                      {/* Image preview */}
                      <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
                        {order.creative?.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={order.creative.imageUrl}
                            alt={order.creative.altText ?? 'Ad'}
                            className="w-24 h-24 object-cover rounded border border-white/10"
                          />
                        ) : (
                          <div className="w-24 h-24 rounded border border-white/10 bg-white/5 flex items-center justify-center">
                            <span className="text-white/20 text-[10px]">no image</span>
                          </div>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-400/10 text-amber-400">
                          PENDING
                        </span>
                      </div>

                      {/* Order details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {/* Tile count + mode + rate */}
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-white font-bold text-sm">
                                {order.tileCount} tile{order.tileCount !== 1 ? 's' : ''}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                order.creative?.displayMode === 'STRETCH'
                                  ? 'bg-blue-400/10 text-blue-400'
                                  : 'bg-white/5 text-white/30'
                              }`}>
                                {order.creative?.displayMode === 'STRETCH'
                                  ? `Stretch ${order.blockCols}×${order.blockRows}`
                                  : 'Repeat'}
                              </span>
                              <span className="text-white/30 text-[10px] font-mono">
                                ${order.dailyRateTotal.toFixed(2)}/day
                              </span>
                            </div>

                            {/* Display mode description */}
                            <div className="text-[10px] text-white/30 mb-1.5">
                              {order.creative?.displayMode === 'STRETCH'
                                ? `Stretches across ${order.blockCols}×${order.blockRows} block`
                                : `Repeats across ${order.tileCount} tile${order.tileCount !== 1 ? 's' : ''}`}
                            </div>

                            {/* Advertiser */}
                            {order.user.walletAddress ? (
                              <div className="text-green-400/70 text-xs font-mono truncate" title={order.user.walletAddress}>
                                {order.user.walletAddress.slice(0, 6)}…{order.user.walletAddress.slice(-4)}
                              </div>
                            ) : null}
                            {order.user.email ? (
                              <div className="text-white/40 text-xs truncate">{order.user.email}</div>
                            ) : !order.user.walletAddress ? (
                              <div className="text-white/20 text-xs">unknown advertiser</div>
                            ) : null}

                            {/* Dest URL */}
                            {order.creative?.destUrl && (
                              <a
                                href={order.creative.destUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-green-400 hover:text-green-300 truncate block max-w-xs mt-0.5"
                              >
                                {order.creative.destUrl}
                              </a>
                            )}

                            {/* Image URL */}
                            {order.creative?.imageUrl ? (
                              <a
                                href={order.creative.imageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-white/20 hover:text-white/40 font-mono truncate block max-w-xs mt-0.5 transition-colors"
                                title={order.creative.imageUrl}
                              >
                                {order.creative.imageUrl}
                              </a>
                            ) : (
                              <div className="text-[10px] text-red-400/60 mt-0.5">⚠ no imageUrl</div>
                            )}

                            <div className="text-white/30 text-xs mt-1">
                              {new Date(order.createdAt).toLocaleString()}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex flex-col gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => act('approve_order', { creativeId: order.creativeId ?? '' })}
                              className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 text-xs px-3 py-1.5 rounded transition-colors"
                            >
                              Approve Order
                            </button>
                            <button
                              onClick={() => act('reject_order', { creativeId: order.creativeId ?? '' })}
                              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 text-xs px-3 py-1.5 rounded transition-colors"
                            >
                              Reject Order
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {view === 'active' && (
            <div className="space-y-3">
              {rentals.length === 0 ? (
                <div className="text-white/30 text-sm text-center py-12">No active rentals.</div>
              ) : (
                rentals.map((r) => (
                  <div key={r.id} className="border border-white/10 rounded-xl p-4 bg-white/2 flex gap-4">
                    <div className="flex-shrink-0 flex flex-col items-center gap-1">
                      {r.creative?.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={r.creative.imageUrl}
                          alt={r.creative.altText ?? 'Ad'}
                          className="w-20 h-20 object-cover rounded border border-white/10"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded border border-white/10 bg-white/5 flex items-center justify-center">
                          <span className="text-white/20 text-[10px]">no image</span>
                        </div>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-400/10 text-green-400">
                        LIVE
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-white font-mono text-sm">Tile #{r.tileId}</div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              r.creative?.displayMode === 'STRETCH'
                                ? 'bg-blue-400/10 text-blue-400'
                                : 'bg-white/5 text-white/30'
                            }`}>
                              {r.creative?.displayMode === 'STRETCH' ? 'Stretch' : 'Repeat'}
                            </span>
                          </div>
                          {r.user.walletAddress ? (
                            <div className="text-green-400/70 text-xs font-mono truncate mt-0.5" title={r.user.walletAddress}>
                              {r.user.walletAddress.slice(0, 6)}…{r.user.walletAddress.slice(-4)}
                            </div>
                          ) : null}
                          {r.user.email ? (
                            <div className="text-white/40 text-xs truncate mt-0.5">{r.user.email}</div>
                          ) : !r.user.walletAddress ? (
                            <div className="text-white/20 text-xs mt-0.5">unknown</div>
                          ) : null}
                          {r.creative?.destUrl && (
                            <a
                              href={r.creative.destUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-green-400 hover:text-green-300 truncate block max-w-xs mt-0.5"
                            >
                              {r.creative.destUrl}
                            </a>
                          )}
                          {r.creative?.imageUrl ? (
                            <a
                              href={r.creative.imageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-white/20 hover:text-white/40 font-mono truncate block max-w-xs mt-0.5 transition-colors"
                              title={r.creative.imageUrl}
                            >
                              {r.creative.imageUrl}
                            </a>
                          ) : (
                            <div className="text-[10px] text-red-400/60 mt-0.5">⚠ no imageUrl</div>
                          )}
                          <div className="text-white/30 text-xs mt-1">
                            {new Date(r.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          <button
                            onClick={() => act('expire', { rentalId: r.id })}
                            className="bg-white/5 hover:bg-white/10 border border-white/20 text-white/60 text-xs px-3 py-1.5 rounded transition-colors"
                          >
                            Expire
                          </button>
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

          {view === 'topups' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {(['pending', 'confirmed', 'unmatched'] as const).map((sv) => (
                    <button
                      key={sv}
                      onClick={() => setTopupSubview(sv)}
                      className={`px-3 py-1.5 text-xs rounded transition-colors ${
                        topupSubview === sv
                          ? 'bg-amber-400/20 text-amber-400'
                          : 'text-white/40 hover:text-white'
                      }`}
                    >
                      {sv.charAt(0).toUpperCase() + sv.slice(1)}
                      <span className="ml-1.5 text-[10px] text-white/30">
                        ({sv === 'pending' ? topupData.pending.length
                          : sv === 'confirmed' ? topupData.confirmed.length
                          : topupData.unmatched.length})
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => act('reconcile')}
                  className="text-xs bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-400 px-3 py-1.5 rounded transition-colors"
                >
                  Run reconciliation
                </button>
              </div>

              {topupSubview === 'pending' && (
                <div className="space-y-2">
                  {topupData.pending.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No pending top-ups.</p>
                  ) : topupData.pending.map((t) => (
                    <div key={t.id} className="border border-white/10 rounded-xl p-4 bg-white/2 flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            t.status === 'PENDING' ? 'bg-amber-400/10 text-amber-400' : 'bg-white/10 text-white/40'
                          }`}>{t.status}</span>
                          <span className="text-white/50 text-xs">{t.user.email ?? t.userId}</span>
                        </div>
                        <div className="text-white/30 text-[10px] font-mono truncate">
                          From: {t.advertiserWallet ?? '—'}
                        </div>
                        <div className="text-white/30 text-[10px] font-mono truncate">
                          To: {t.depositWallet ?? '—'}
                        </div>
                        <div className="text-white/30 text-[10px]">
                          Created: {new Date(t.createdAt).toLocaleString()}
                          {t.expiresAt && ` · Expires: ${new Date(t.expiresAt).toLocaleString()}`}
                        </div>
                      </div>
                      <button
                        onClick={() => act('expire_topup', { topupId: t.id })}
                        className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/50 px-3 py-1.5 rounded transition-colors"
                      >
                        Expire
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {topupSubview === 'confirmed' && (
                <div className="space-y-2">
                  {topupData.confirmed.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No confirmed top-ups.</p>
                  ) : topupData.confirmed.map((t) => (
                    <div key={t.id} className="border border-white/10 rounded-xl p-4 bg-white/2 flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-400/10 text-green-400">CONFIRMED</span>
                          <span className="text-white font-mono font-bold text-sm">
                            ${Number(t.actualAmount ?? t.amount).toFixed(2)} USDC
                          </span>
                          <span className="text-white/50 text-xs">{t.user.email ?? t.userId}</span>
                        </div>
                        {t.txSignature && (
                          <a
                            href={`https://solscan.io/tx/${t.txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-blue-400/70 hover:text-blue-400 font-mono block"
                          >
                            {t.txSignature.slice(0, 16)}… ↗
                          </a>
                        )}
                        <div className="text-white/30 text-[10px]">
                          {t.confirmedAt ? new Date(t.confirmedAt).toLocaleString() : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {topupSubview === 'unmatched' && (
                <div className="space-y-2">
                  {topupData.unmatched.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No unmatched transactions.</p>
                  ) : topupData.unmatched.map((tx) => (
                    <div key={tx.id} className="border border-white/10 rounded-xl p-4 bg-white/2 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-mono font-bold text-sm">
                          ${Number(tx.amountUsdc).toFixed(2)} USDC
                        </span>
                        <span className="text-white/30 text-[10px] uppercase">{tx.source}</span>
                      </div>
                      <div className="text-white/30 text-[10px] font-mono">From: {tx.senderWallet ?? '—'}</div>
                      <a
                        href={`https://solscan.io/tx/${tx.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-400/70 hover:text-blue-400 font-mono block"
                      >
                        {tx.signature.slice(0, 20)}… ↗
                      </a>
                      <div className="text-white/30 text-[10px]">{new Date(tx.processedAt).toLocaleString()}</div>
                      <p className="text-white/20 text-[10px]">
                        To assign manually: note the tx ID and use the assign_topup admin action.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === 'pricing' && (
            <div className="max-w-lg">
              <form onSubmit={savePricing} className="space-y-5">
                <div className="border border-white/10 rounded-xl p-5 bg-white/2 space-y-4">
                  <h3 className="text-sm font-bold text-white">Tile Pricing</h3>

                  <div>
                    <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
                      Price per tile per day (USD)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pricingForm.tile_price_usd_per_day}
                      onChange={(e) => setPricingForm((f) => ({ ...f, tile_price_usd_per_day: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                    />
                    <p className="text-white/30 text-xs mt-1">
                      e.g. 0 = free, 0.10, 1, 5
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
                      Management fee (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={pricingForm.management_fee_percent}
                      onChange={(e) => setPricingForm((f) => ({ ...f, management_fee_percent: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                <div className="border border-white/10 rounded-xl p-5 bg-white/2 space-y-4">
                  <h3 className="text-sm font-bold text-white">Free Rental Promo</h3>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="free-rental-enabled"
                      checked={pricingForm.free_rental_enabled === 'true'}
                      onChange={(e) =>
                        setPricingForm((f) => ({ ...f, free_rental_enabled: e.target.checked ? 'true' : 'false' }))
                      }
                      className="w-4 h-4 accent-amber-400"
                    />
                    <label htmlFor="free-rental-enabled" className="text-sm text-white/70 cursor-pointer">
                      Enable free rental promo
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
                      Free days
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={pricingForm.free_rental_days}
                      onChange={(e) => setPricingForm((f) => ({ ...f, free_rental_days: e.target.value }))}
                      disabled={pricingForm.free_rental_enabled !== 'true'}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400 disabled:opacity-40"
                    />
                    <p className="text-white/30 text-xs mt-1">
                      When enabled, new rentals are submitted at $0/day for this many days.
                    </p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={pricingSaving}
                  className="w-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 font-bold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {pricingSaving ? 'Saving…' : 'Save pricing settings'}
                </button>
              </form>
            </div>
          )}

          {view === 'reset' && (
            <div className="space-y-5 max-w-2xl">

              {/* Target wallet selector */}
              <div className="border border-white/10 rounded-xl p-4 bg-white/2 space-y-3">
                <h3 className="text-sm font-bold text-white">Target Account</h3>
                <div className="flex gap-2">
                  <input
                    value={resetWallet}
                    onChange={(e) => { setResetWallet(e.target.value); setResetState(null) }}
                    placeholder="Wallet address"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-400 placeholder-white/20"
                  />
                  <button
                    onClick={() => loadResetState(resetWallet)}
                    disabled={!resetWallet || resetting}
                    className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                  >
                    Load
                  </button>
                </div>
                {connectedAddress && connectedAddress !== resetWallet && (
                  <button
                    onClick={() => { setResetWallet(connectedAddress); loadResetState(connectedAddress) }}
                    className="text-[10px] text-amber-400/70 hover:text-amber-400 transition-colors"
                  >
                    Use connected wallet ({connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)})
                  </button>
                )}
              </div>

              {/* Current state */}
              {resetState && (
                <div className="border border-white/10 rounded-xl p-4 bg-white/2 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Current State</h3>
                    <button
                      onClick={() => loadResetState(resetWallet)}
                      className="text-[10px] text-white/30 hover:text-white transition-colors"
                    >
                      Refresh
                    </button>
                  </div>
                  {resetState.userId ? (
                    <>
                      <div className="text-[10px] text-white/30 font-mono truncate">{resetWallet}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          { label: 'Balance', value: `$${resetState.balance.toFixed(2)}`, hi: resetState.balance > 0 ? 'text-green-400' : 'text-white' },
                          { label: 'Pending topups', value: resetState.pendingTopups, hi: resetState.pendingTopups > 0 ? 'text-amber-400' : 'text-white' },
                          { label: 'Confirmed topups', value: resetState.confirmedTopups, hi: 'text-white' },
                          { label: 'Active rentals', value: resetState.activeRentals, hi: resetState.activeRentals > 0 ? 'text-green-400' : 'text-white' },
                          { label: 'Pending rentals', value: resetState.pendingRentals, hi: resetState.pendingRentals > 0 ? 'text-amber-400' : 'text-white' },
                          { label: 'Rented tiles', value: resetState.activeRentals + resetState.pendingRentals, hi: 'text-white' },
                        ].map(({ label, value, hi }) => (
                          <div key={label} className="bg-white/3 rounded-lg p-2.5">
                            <div className="text-[10px] text-white/40 mb-1">{label}</div>
                            <div className={`text-sm font-mono font-bold ${hi}`}>{value}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-white/30 text-sm">No user found for this wallet address.</p>
                  )}
                </div>
              )}

              {/* Action 1: Reset advertiser test account */}
              {resetState?.userId && (
                <div className="border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-bold text-amber-400">Reset Advertiser Test Account</h3>
                  <p className="text-white/40 text-xs">
                    This will reset test balance and expire pending test topups. Confirmed on-chain topups remain in history and are not deleted.
                  </p>
                  {resetConfirm1 ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleReset('reset_test_account')}
                        disabled={resetting}
                        className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-4 py-1.5 rounded transition-colors disabled:opacity-50"
                      >
                        {resetting ? 'Resetting…' : 'Confirm — reset balance & topups'}
                      </button>
                      <button
                        onClick={() => setResetConfirm1(false)}
                        className="text-xs text-white/40 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setResetConfirm1(true)}
                      className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/70 px-4 py-1.5 rounded transition-colors"
                    >
                      Reset my advertiser test account
                    </button>
                  )}
                </div>
              )}

              {/* Action 2: Clear test rentals */}
              {resetState?.userId && (
                <div className="border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-bold text-amber-400">Clear Test Rentals</h3>
                  <p className="text-white/40 text-xs">
                    Expires all active and pending rentals for this wallet. Tiles are freed. Database history is preserved.
                  </p>
                  {resetConfirm2 ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleReset('clear_test_rentals')}
                        disabled={resetting}
                        className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-4 py-1.5 rounded transition-colors disabled:opacity-50"
                      >
                        {resetting ? 'Clearing…' : `Confirm — expire ${resetState.activeRentals + resetState.pendingRentals} rental(s)`}
                      </button>
                      <button
                        onClick={() => setResetConfirm2(false)}
                        className="text-xs text-white/40 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setResetConfirm2(true)}
                      disabled={(resetState.activeRentals + resetState.pendingRentals) === 0}
                      className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/70 px-4 py-1.5 rounded transition-colors disabled:opacity-40"
                    >
                      Clear test rentals
                    </button>
                  )}
                </div>
              )}

              {/* Action 3: Clear full board — dangerous */}
              <div className="border border-red-500/30 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-red-400">Clear Full Board Test Data</h3>
                <p className="text-red-400/60 text-xs">
                  Dangerous: expires ALL active and pending rentals across every advertiser board-wide. Revenue and topup history is preserved.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={fullBoardConfirm}
                    onChange={(e) => setFullBoardConfirm(e.target.value)}
                    placeholder="Type CONFIRM to enable"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-red-400 placeholder-white/20"
                  />
                  <button
                    onClick={handleClearFullBoard}
                    disabled={fullBoardConfirm !== 'CONFIRM' || resetting}
                    className="text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 px-4 py-1.5 rounded transition-colors disabled:opacity-40"
                  >
                    {resetting ? 'Clearing…' : 'Clear full board'}
                  </button>
                </div>
              </div>

            </div>
          )}
        </>
      )}
    </div>
  )
}
