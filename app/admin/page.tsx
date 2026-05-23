'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'

type AdminView = 'pending' | 'active' | 'billing' | 'epochs' | 'pricing' | 'topups' | 'reset' | 'distribution'

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

interface DistributionEpoch {
  id: string
  epochDate: string
  status: string
  adRevenue: string
  tradingFeeRevenue: string
  grossPool: string
  managementFeePercent: string
  managementFeeAmount: string
  claimPoolAmount: string
  totalPool: string
  eligibleSupply: string
  snapshotDate: string | null
  publishedAt: string | null
  closedAt: string | null
  billingRunId: string | null
  _count?: { holderSnapshots: number; claims: number }
}

interface RevenueEvent {
  id: string
  type: string
  source: string
  amount: string
  currency: string
  wallet: string | null
  txSignature: string | null
  billingRunId: string | null
  userId: string | null
  rentalId: string | null
  epochId: string | null
  createdAt: string
}

interface ExcludedWallet {
  id: string
  walletAddress: string
  label: string | null
  reason: string | null
  createdAt: string
}

interface DebugAuth {
  hasAdminWalletEnv: boolean
  maskedAdminWallet: string | null
  walletMatch: boolean
  isAdminSession: boolean
}

interface CurrentEpochData {
  epoch: DistributionEpoch
  liveRevenue: {
    adRevenue: number
    tradingFeeRevenue: number
    grossPool: number
    feePercent: number
    estimatedMgmtFee: number
    estimatedClaimPool: number
  }
  msUntilClose: number
}

interface ReconcileDetail {
  signature: string
  sender: string
  receiver: string
  amount: number
  matched: boolean
  skipped: boolean
  reason?: string
}

interface ReconcileResult {
  ok: boolean
  scannedTransactions: number
  usdcTransfersFound: number
  matchedTopups: number
  unmatchedDeposits: number
  duplicatesIgnored: number
  expiredTopups: number
  errors: string[]
  details: ReconcileDetail[]
}

interface TxSigCheckResult {
  ok: boolean
  found?: boolean
  message?: string
  error?: string
  results?: Array<{ matched: boolean; skipped: boolean; reason?: string; amount: number; sender: string }>
}

export default function AdminPage() {
  const { publicKey, connecting } = useWallet()
  const { setVisible: openWalletModal } = useWalletModal()
  const connectedAddress = publicKey?.toBase58() ?? ''

  const [mounted, setMounted] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [debugAuth, setDebugAuth] = useState<DebugAuth | null>(null)
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
  // Distribution state
  const [distEpochs, setDistEpochs] = useState<DistributionEpoch[]>([])
  const [revenueEvents, setRevenueEvents] = useState<RevenueEvent[]>([])
  const [excludedWallets, setExcludedWallets] = useState<ExcludedWallet[]>([])
  const [distSubview, setDistSubview] = useState<'epochs' | 'events' | 'excluded'>('epochs')
  const [snapshotRunning, setSnapshotRunning] = useState(false)
  const [newExcludedWallet, setNewExcludedWallet] = useState('')
  const [newExcludedLabel, setNewExcludedLabel] = useState('')
  const [currentEpochData, setCurrentEpochData] = useState<CurrentEpochData | null>(null)
  const [epochCountdown, setEpochCountdown] = useState('')
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null)
  const [reconcileRunning, setReconcileRunning] = useState(false)
  const [txSigInputs, setTxSigInputs] = useState<Record<string, string>>({})
  const [txSigResults, setTxSigResults] = useState<Record<string, TxSigCheckResult>>({})
  const [txSigRunning, setTxSigRunning] = useState<Record<string, boolean>>({})

  // Hydration guard
  useEffect(() => { setMounted(true) }, [])

  // Fetch server-side wallet match info whenever connected wallet changes
  useEffect(() => {
    setDebugAuth(null) // reset immediately on wallet change (avoids stale state)
    const controller = new AbortController()
    const url = connectedAddress
      ? `/api/admin/debug-auth?wallet=${encodeURIComponent(connectedAddress)}`
      : '/api/admin/debug-auth'
    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DebugAuth | null) => {
        setDebugAuth(d)
        if (d?.isAdminSession && d?.walletMatch) setAuthed(true)
      })
      .catch((err) => { if (err.name !== 'AbortError') setDebugAuth(null) })
    return () => controller.abort()
  }, [connectedAddress])

  // Revoke access when admin wallet disconnects or changes away from admin wallet
  useEffect(() => {
    if (authed && debugAuth !== null && !debugAuth.walletMatch) {
      setAuthed(false)
      setPassword('')
      setAuthError('')
    }
  }, [debugAuth, authed])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
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
      setAuthError(d.error ?? 'Login failed')
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
    } else if (view === 'distribution') {
      const [epochsRes, eventsRes, excludedRes, currentEpochRes] = await Promise.all([
        fetch('/api/admin?view=distribution'),
        fetch('/api/admin?view=revenue_events'),
        fetch('/api/admin?view=excluded_wallets'),
        fetch('/api/admin?view=current_epoch'),
      ])
      if (epochsRes.ok) { const d = await epochsRes.json(); setDistEpochs(d.epochs ?? []) }
      if (eventsRes.ok) { const d = await eventsRes.json(); setRevenueEvents(d.events ?? []) }
      if (excludedRes.ok) { const d = await excludedRes.json(); setExcludedWallets(d.wallets ?? []) }
      if (currentEpochRes.ok) { const d = await currentEpochRes.json(); setCurrentEpochData(d) }
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

  // Live countdown to UTC midnight
  useEffect(() => {
    if (view !== 'distribution') return
    const tick = () => {
      const now = Date.now()
      const nextMidnight = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate() + 1
      )
      const ms = nextMidnight - now
      const h = Math.floor(ms / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setEpochCountdown(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [view])

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

  const runDistributionAction = async (action: string, extra: Record<string, string> = {}) => {
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
    return { ok: res.ok, data: d }
  }

  const runRealSnapshot = async (epochId: string) => {
    setSnapshotRunning(true)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run_snapshot', epochId }),
    })
    const d = await res.json()
    setSnapshotRunning(false)
    if (res.ok) {
      setActionMsg(`Snapshot done: ${d.holdersSnapshotted} holders`)
      setTimeout(() => setActionMsg(''), 3000)
      load()
    } else {
      setActionMsg(d.error ?? 'Snapshot failed')
    }
  }

  const runReconcile = async () => {
    setReconcileRunning(true)
    setReconcileResult(null)
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconcile' }),
      })
      const d = await res.json()
      setReconcileResult(d)
      if (res.ok) load()
    } catch {
      setReconcileResult({
        ok: false, scannedTransactions: 0, usdcTransfersFound: 0, matchedTopups: 0,
        unmatchedDeposits: 0, duplicatesIgnored: 0, expiredTopups: 0,
        errors: ['Network error — check console'], details: [],
      })
    } finally {
      setReconcileRunning(false)
    }
  }

  const checkTxSig = async (topupId: string) => {
    const sig = txSigInputs[topupId]?.trim()
    if (!sig) return
    setTxSigRunning((r) => ({ ...r, [topupId]: true }))
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_tx_signature', signature: sig }),
      })
      const d = await res.json()
      setTxSigResults((r) => ({ ...r, [topupId]: d }))
      if (res.ok && d.ok) load()
    } catch {
      setTxSigResults((r) => ({ ...r, [topupId]: { ok: false, error: 'Network error' } }))
    } finally {
      setTxSigRunning((r) => ({ ...r, [topupId]: false }))
    }
  }

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/30 text-sm animate-pulse">Loading…</div>
      </div>
    )
  }

  if (!authed) {
    // Debug info panel — shown on all login screens
    const DebugPanel = () => (
      <div className="mt-6 border border-white/5 rounded-lg p-3 bg-white/2 text-[10px] font-mono space-y-1 text-left">
        <div className="text-white/30 uppercase tracking-widest mb-1.5">Auth debug</div>
        <div className="flex justify-between gap-2">
          <span className="text-white/30">ADMIN_WALLET set</span>
          <span className={debugAuth?.hasAdminWalletEnv ? 'text-green-400' : 'text-red-400'}>
            {debugAuth === null ? '…' : debugAuth.hasAdminWalletEnv ? 'yes' : 'no'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-white/30">configured wallet</span>
          <span className="text-white/50">{debugAuth?.maskedAdminWallet ?? '—'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-white/30">connected wallet</span>
          <span className="text-white/50">
            {connectedAddress ? `${connectedAddress.slice(0, 4)}…${connectedAddress.slice(-4)}` : '—'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-white/30">wallet match</span>
          <span className={debugAuth?.walletMatch ? 'text-green-400' : 'text-red-400'}>
            {debugAuth === null ? '…' : debugAuth.walletMatch ? 'yes' : 'no'}
          </span>
        </div>
      </div>
    )

    // Step 1: no wallet connected (or connecting)
    if (!publicKey) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-xs text-center">
            <h1 className="text-xl font-black text-amber-400 mb-4">Admin</h1>
            {connecting ? (
              <p className="text-white/30 text-sm animate-pulse mb-6">Connecting wallet…</p>
            ) : (
              <>
                <p className="text-white/50 text-sm mb-6">Connect the admin wallet to continue.</p>
                <button
                  onClick={() => openWalletModal(true)}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-2.5 rounded-lg text-sm transition-colors"
                >
                  Connect Wallet
                </button>
                {!debugAuth?.hasAdminWalletEnv && debugAuth !== null && (
                  <p className="text-red-400/70 text-xs mt-4">ADMIN_WALLET is not configured.</p>
                )}
              </>
            )}
            <DebugPanel />
          </div>
        </div>
      )
    }

    // Step 2: wallet connected but waiting for debug-auth response, or wrong wallet
    if (!debugAuth?.walletMatch) {
      const stillLoading = debugAuth === null
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-xs text-center">
            <h1 className="text-xl font-black text-amber-400 mb-4">Admin</h1>
            {stillLoading ? (
              <p className="text-white/30 text-sm animate-pulse">Checking wallet…</p>
            ) : !debugAuth.hasAdminWalletEnv ? (
              <p className="text-red-400 text-sm">ADMIN_WALLET is not configured.</p>
            ) : (
              <p className="text-red-400 text-sm">This wallet is not authorized for admin access.</p>
            )}
            <DebugPanel />
          </div>
        </div>
      )
    }

    // Step 3: correct admin wallet confirmed by server — require password
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
              autoFocus
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
          <DebugPanel />
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
        {(['pending', 'active', 'billing', 'epochs', 'distribution', 'pricing', 'topups', 'reset'] as AdminView[]).map((v) => (
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
              : v === 'epochs' ? 'Epochs (legacy)'
              : v === 'distribution' ? 'Distribution'
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
                  onClick={runReconcile}
                  disabled={reconcileRunning}
                  className="text-xs bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-400 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                >
                  {reconcileRunning ? 'Running…' : 'Run reconciliation'}
                </button>
              </div>

              {/* Reconcile result panel */}
              {reconcileResult && (
                <div className={`border rounded-xl p-4 space-y-3 ${reconcileResult.ok ? 'border-blue-500/30 bg-blue-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-white">Reconciliation Result</div>
                    <button onClick={() => setReconcileResult(null)} className="text-white/30 text-xs hover:text-white transition-colors">✕</button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      { label: 'Scanned', v: reconcileResult.scannedTransactions, color: '' },
                      { label: 'USDC found', v: reconcileResult.usdcTransfersFound, color: '' },
                      { label: 'Matched', v: reconcileResult.matchedTopups, color: reconcileResult.matchedTopups > 0 ? 'text-green-400' : '' },
                      { label: 'Unmatched', v: reconcileResult.unmatchedDeposits, color: reconcileResult.unmatchedDeposits > 0 ? 'text-amber-400' : '' },
                      { label: 'Duplicates', v: reconcileResult.duplicatesIgnored, color: '' },
                      { label: 'Expired', v: reconcileResult.expiredTopups, color: '' },
                    ].map(({ label, v, color }) => (
                      <div key={label} className="bg-white/3 rounded p-2">
                        <div className={`font-mono font-bold text-sm ${color || 'text-white'}`}>{v}</div>
                        <div className="text-white/30 text-[10px]">{label}</div>
                      </div>
                    ))}
                  </div>
                  {reconcileResult.errors.length > 0 && (
                    <div className="space-y-1">
                      {reconcileResult.errors.map((err, i) => (
                        <div key={i} className="text-red-400 text-[10px] font-mono">{err}</div>
                      ))}
                    </div>
                  )}
                  {reconcileResult.details.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {reconcileResult.details.map((d, i) => (
                        <div key={i} className={`flex items-center gap-2 text-[10px] font-mono ${d.matched ? 'text-green-400/70' : d.skipped ? 'text-white/30' : 'text-amber-400/70'}`}>
                          <span className="flex-shrink-0">{d.matched ? '✓' : d.skipped ? '·' : '?'}</span>
                          <span>{d.signature.slice(0, 12)}…</span>
                          <span>${d.amount.toFixed(4)}</span>
                          <span>{d.matched ? 'matched' : d.skipped ? `skip(${d.reason})` : `unmatched(${d.reason})`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {topupSubview === 'pending' && (
                <div className="space-y-2">
                  {topupData.pending.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No pending top-ups.</p>
                  ) : topupData.pending.map((t) => (
                    <div key={t.id} className="border border-white/10 rounded-xl p-4 bg-white/2 space-y-3">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              t.status === 'PENDING' ? 'bg-amber-400/10 text-amber-400' : 'bg-white/10 text-white/40'
                            }`}>{t.status}</span>
                            <span className="text-white font-mono font-bold text-sm">
                              ${Number(t.amount).toFixed(2)} USDC
                            </span>
                            <span className="text-white/50 text-xs">{t.user.email ?? t.userId.slice(0, 8) + '…'}</span>
                          </div>
                          <div className="text-white/20 text-[10px] font-mono">ID: {t.id}</div>
                        </div>
                        <button
                          onClick={() => act('expire_topup', { topupId: t.id })}
                          className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/50 px-3 py-1.5 rounded transition-colors flex-shrink-0"
                        >
                          Expire
                        </button>
                      </div>

                      {/* Wallet info */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-mono break-all">
                          <span className="text-white/30">From: </span>
                          <span className="text-white/60">{t.advertiserWallet ?? '—'}</span>
                        </div>
                        <div className="text-[10px] font-mono break-all">
                          <span className="text-white/30">To: </span>
                          <span className="text-white/60">{t.depositWallet ?? '—'}</span>
                        </div>
                        <div className="text-[10px] text-white/30">
                          Created: {new Date(t.createdAt).toLocaleString()}
                          {t.expiresAt && ` · Expires: ${new Date(t.expiresAt).toLocaleString()}`}
                        </div>
                        {t.txSignature && (
                          <a
                            href={`https://solscan.io/tx/${t.txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-blue-400/70 hover:text-blue-400 font-mono block"
                          >
                            {t.txSignature.slice(0, 20)}… ↗
                          </a>
                        )}
                      </div>

                      {/* Manual tx recovery */}
                      <div className="space-y-1.5 pt-1 border-t border-white/5">
                        <div className="text-[10px] text-white/25 uppercase tracking-widest">Manual tx recovery</div>
                        <div className="flex gap-2">
                          <input
                            value={txSigInputs[t.id] ?? ''}
                            onChange={(e) => setTxSigInputs((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            placeholder="Paste Solscan tx signature…"
                            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-[10px] font-mono focus:outline-none focus:border-blue-400 placeholder-white/20"
                          />
                          <button
                            onClick={() => checkTxSig(t.id)}
                            disabled={!txSigInputs[t.id]?.trim() || !!txSigRunning[t.id]}
                            className="text-[10px] bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-400 px-2 py-1 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                          >
                            {txSigRunning[t.id] ? '…' : 'Check'}
                          </button>
                        </div>
                        {txSigResults[t.id] && (() => {
                          const r = txSigResults[t.id]
                          if (r.error) return <div className="text-red-400 text-[10px]">{r.error}</div>
                          if (!r.found) return <div className="text-amber-400 text-[10px]">{r.message}</div>
                          return (
                            <div className="space-y-1">
                              {r.results?.map((res, i) => (
                                <div key={i} className={`text-[10px] font-mono ${res.matched ? 'text-green-400' : res.skipped ? 'text-white/50' : 'text-amber-400'}`}>
                                  ${res.amount.toFixed(4)} from {res.sender.slice(0, 8)}… — {res.matched ? 'Matched & credited ✓' : res.skipped ? `Duplicate (${res.reason})` : `Unmatched (${res.reason})`}
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
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

          {view === 'distribution' && (
            <div className="space-y-4">
              {/* Sub-tab bar */}
              <div className="flex gap-1">
                {(['epochs', 'events', 'excluded'] as const).map((sv) => (
                  <button
                    key={sv}
                    onClick={() => setDistSubview(sv)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      distSubview === sv ? 'bg-amber-400/20 text-amber-400' : 'text-white/40 hover:text-white'
                    }`}
                  >
                    {sv === 'epochs' ? `Epochs (${distEpochs.length})`
                      : sv === 'events' ? `Revenue Events (${revenueEvents.length})`
                      : `Excluded Wallets (${excludedWallets.length})`}
                  </button>
                ))}
              </div>

              {/* Epochs sub-tab */}
              {distSubview === 'epochs' && (
                <div className="space-y-5">
                  {/* Current UTC Epoch card */}
                  {currentEpochData && (() => {
                    const { epoch: ce, liveRevenue: lr } = currentEpochData
                    const d = new Date(ce.epochDate)
                    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} UTC`
                    return (
                      <div className="border border-amber-400/30 bg-amber-400/5 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] text-amber-400/60 uppercase tracking-widest mb-0.5">Current UTC Epoch</div>
                            <div className="text-white font-bold">{dateStr}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-0.5">Closes in</div>
                            <div className="font-mono text-amber-400 font-bold">{epochCountdown}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          {[
                            { label: 'Ad revenue', v: lr.adRevenue, color: 'text-green-400' },
                            { label: 'Fee revenue', v: lr.tradingFeeRevenue, color: 'text-blue-400' },
                            { label: 'Est. claim pool', v: lr.estimatedClaimPool, color: 'text-amber-400' },
                          ].map(({ label, v, color }) => (
                            <div key={label} className="bg-white/3 rounded p-2">
                              <div className={`font-mono font-bold ${color}`}>${v.toFixed(2)}</div>
                              <div className="text-white/30 text-[10px]">{label}</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => runDistributionAction('trigger_close_epoch')}
                            className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded transition-colors"
                          >
                            Close previous epoch now
                          </button>
                          <button
                            onClick={() => runDistributionAction('seed_excluded_wallets')}
                            className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/50 px-3 py-1.5 rounded transition-colors"
                          >
                            Seed excluded system wallets
                          </button>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Epoch cards */}
                  {distEpochs.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No epochs yet. The current UTC epoch auto-creates on first billing.</p>
                  ) : distEpochs.map((ep) => {
                    const gross = Number(ep.grossPool)
                    const claimPool = Number(ep.claimPoolAmount || ep.totalPool)
                    const ed = new Date(ep.epochDate)
                    const epochDateStr = `${ed.getUTCFullYear()}-${String(ed.getUTCMonth()+1).padStart(2,'0')}-${String(ed.getUTCDate()).padStart(2,'0')} UTC`
                    const statusColor =
                      ep.status === 'PUBLISHED' ? 'text-green-400 bg-green-400/10'
                      : ep.status === 'CLOSED' ? 'text-white/30 bg-white/5'
                      : ep.status === 'SNAPSHOTTED' ? 'text-blue-400 bg-blue-400/10'
                      : ep.status === 'BILLED' ? 'text-amber-400 bg-amber-400/10'
                      : ep.status === 'OPEN' ? 'text-cyan-400 bg-cyan-400/10'
                      : ep.status === 'PROCESSING' ? 'text-yellow-400 bg-yellow-400/10'
                      : ep.status === 'FAILED' ? 'text-red-400 bg-red-400/10'
                      : ep.status === 'READY_NO_TOKEN' ? 'text-purple-400 bg-purple-400/10'
                      : 'text-white/50 bg-white/5'
                    return (
                      <div key={ep.id} className="border border-white/10 rounded-xl p-4 bg-white/2 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-white font-bold">{epochDateStr}</div>
                            <div className="text-white/25 text-[10px] font-mono">{ep.id}</div>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{ep.status}</span>
                        </div>

                        {/* Revenue breakdown */}
                        {gross > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            {[
                              { label: 'Ad revenue', v: Number(ep.adRevenue), color: 'text-green-400' },
                              { label: 'Fee revenue', v: Number(ep.tradingFeeRevenue), color: 'text-blue-400' },
                              { label: 'Mgmt fee', v: Number(ep.managementFeeAmount), color: 'text-white/50' },
                              { label: 'Claim pool', v: claimPool, color: 'text-green-400' },
                            ].map(({ label, v, color }) => (
                              <div key={label} className="bg-white/3 rounded p-2">
                                <div className={`font-mono font-bold ${color}`}>${v.toFixed(2)}</div>
                                <div className="text-white/30 text-[10px]">{label}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-white/30 text-xs">No revenue computed yet</div>
                        )}

                        {ep._count && (
                          <div className="flex gap-4 text-xs text-white/40">
                            <span>{ep._count.holderSnapshots} holder snapshots</span>
                            <span>{ep._count.claims} claims</span>
                            {ep.snapshotDate && <span>Snapshotted {new Date(ep.snapshotDate).toLocaleDateString()}</span>}
                          </div>
                        )}

                        {/* Action buttons per status */}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {(ep.status === 'DRAFT' || ep.status === 'OPEN' || ep.status === 'FAILED') && (
                            <button
                              onClick={() => runDistributionAction('calculate_pool', { epochId: ep.id })}
                              className="text-xs bg-white/10 hover:bg-white/20 text-white/70 px-3 py-1 rounded transition-colors"
                            >
                              Calculate pool
                            </button>
                          )}
                          {(ep.status === 'BILLED' || ep.status === 'DRAFT' || ep.status === 'OPEN') && (
                            <button
                              onClick={() => runRealSnapshot(ep.id)}
                              disabled={snapshotRunning}
                              className="text-xs bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-400 px-3 py-1 rounded transition-colors disabled:opacity-50"
                            >
                              {snapshotRunning ? 'Snapshotting…' : 'Run holder snapshot'}
                            </button>
                          )}
                          {ep.status === 'SNAPSHOTTED' && (
                            <button
                              onClick={() => runDistributionAction('publish_epoch', { epochId: ep.id })}
                              className="text-xs bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 px-3 py-1 rounded transition-colors"
                            >
                              Publish
                            </button>
                          )}
                          {ep.status === 'PUBLISHED' && (
                            <button
                              onClick={() => runDistributionAction('close_epoch', { epochId: ep.id })}
                              className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/40 px-3 py-1 rounded transition-colors"
                            >
                              Close
                            </button>
                          )}
                          {ep.status === 'FAILED' && (
                            <button
                              onClick={() => runDistributionAction('trigger_close_epoch', { epochDate: ep.epochDate })}
                              className="text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 px-3 py-1 rounded transition-colors"
                            >
                              Retry close
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Revenue Events sub-tab */}
              {distSubview === 'events' && (
                <div className="space-y-2">
                  {revenueEvents.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No revenue events yet.</p>
                  ) : revenueEvents.map((ev) => {
                    const typeColor =
                      ev.type === 'AD_RENT_REVENUE' ? 'text-green-400 bg-green-400/10'
                      : ev.type === 'TRADING_FEE_REVENUE' ? 'text-blue-400 bg-blue-400/10'
                      : ev.type === 'MANAGEMENT_FEE' ? 'text-white/50 bg-white/5'
                      : ev.type === 'CLAIM_POOL_ALLOCATION' ? 'text-amber-400 bg-amber-400/10'
                      : ev.type === 'CLAIM_PAYOUT' ? 'text-green-400 bg-green-400/10'
                      : ev.type === 'TOPUP_DEPOSIT' ? 'text-blue-300 bg-blue-300/10'
                      : 'text-white/40 bg-white/5'
                    return (
                      <div key={ev.id} className="border border-white/5 rounded-lg px-4 py-2.5 bg-white/2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium flex-shrink-0 ${typeColor}`}>
                            {ev.type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-white/25 text-[10px]">{ev.source}</span>
                          {ev.txSignature && (
                            <span className="text-white/20 text-[10px] font-mono truncate hidden sm:block">
                              {ev.txSignature.slice(0, 10)}…
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="font-mono font-bold text-sm text-white">${Number(ev.amount).toFixed(4)}</span>
                          <span className="text-white/25 text-[10px]">{new Date(ev.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Excluded Wallets sub-tab */}
              {distSubview === 'excluded' && (
                <div className="space-y-4">
                  {/* Add wallet form */}
                  <div className="border border-white/10 rounded-xl p-4 bg-white/2 space-y-3">
                    <h3 className="text-sm font-bold text-white">Add excluded wallet</h3>
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={newExcludedWallet}
                        onChange={(e) => setNewExcludedWallet(e.target.value)}
                        placeholder="Wallet address"
                        className="flex-1 min-w-40 bg-white/5 border border-white/10 rounded px-3 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-amber-400 placeholder-white/20"
                      />
                      <input
                        value={newExcludedLabel}
                        onChange={(e) => setNewExcludedLabel(e.target.value)}
                        placeholder="Label (optional)"
                        className="w-36 bg-white/5 border border-white/10 rounded px-3 py-1.5 text-white text-xs focus:outline-none focus:border-amber-400 placeholder-white/20"
                      />
                      <button
                        disabled={!newExcludedWallet}
                        onClick={async () => {
                          await runDistributionAction('add_excluded_wallet', {
                            walletAddress: newExcludedWallet,
                            label: newExcludedLabel,
                          })
                          setNewExcludedWallet('')
                          setNewExcludedLabel('')
                        }}
                        className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => runDistributionAction('seed_excluded_wallets')}
                        className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/50 px-3 py-1.5 rounded transition-colors"
                      >
                        Seed system wallets
                      </button>
                    </div>
                  </div>

                  {/* Wallet list */}
                  {excludedWallets.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No excluded wallets. Seed system wallets to get started.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {excludedWallets.map((w) => (
                        <div key={w.id} className="border border-white/5 rounded-lg px-4 py-2.5 bg-white/2 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-mono text-white/70 truncate">{w.walletAddress}</div>
                            {w.label && <div className="text-[10px] text-white/40">{w.label}</div>}
                            {w.reason && <div className="text-[10px] text-white/25">{w.reason}</div>}
                          </div>
                          <button
                            onClick={() => runDistributionAction('remove_excluded_wallet', { walletAddress: w.walletAddress })}
                            className="text-[10px] text-red-400/50 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
