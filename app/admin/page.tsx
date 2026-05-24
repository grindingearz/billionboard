'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'

type AdminView = 'pending' | 'active' | 'billing' | 'epochs' | 'pricing' | 'topups' | 'reset' | 'distribution' | 'users' | 'accounting' | 'settlements'

interface KeyDiagnostic {
  present: boolean
  parseStatus: 'ok' | 'parse_error' | 'missing'
  derivedPubkey: string | null
  derivedPubkeyFull: string | null
  expectedPubkey: string | null
  matches: boolean | null
  error: string | null
}

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
  auto_approve_ads: string
}

interface RentalOrder {
  creativeId: string | null
  userId: string
  tileIds: number[]
  rentalIds: string[]
  tileCount: number
  status: string
  createdAt: string
  startDate: string | null
  nextBillingAt: string | null
  lastBilledAt: string | null
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

interface AccountingData {
  unusedAdvertiserBalances: number
  earnedAdFees: number
  earnedTradingFees: number
  totalSettled: number
  failedSettlements: number
  pendingSettlements: number
  treasurySent: number
  distributionSent: number
  totalTreasuryGenerated: number
  totalDistributionGenerated: number
  pendingAmount: number
  failedAmount: number
  feePercent: number
  walletConfig: {
    topupWallet: string | null
    revenueWallet: string | null
    treasuryWallet: string | null
    distributionWallet: string | null
    feeCreatorWallet: string | null
    adminWallet: string | null
    topupWalletKeyConfigured: boolean
    revenueWalletKeyConfigured: boolean
    feeCreatorWalletKeyConfigured: boolean
    topupKeyDiag: KeyDiagnostic
    revenueKeyDiag: KeyDiagnostic
    feeCreatorKeyDiag: KeyDiagnostic
  }
  reconciliation: {
    confirmedOnChainTopups: number
    mockTopups: number
    activeDailyBurn: number
    activeTileCount: number
    earnedNotYetMoved: number
    expectedTopupWalletBalance: number
    topupWalletOnChain: number | null
    variance: number | null
  }
}

interface SettlementRow {
  id: string
  revenueEventId: string
  sourceWallet: string
  revenueWallet: string
  treasuryWallet: string
  distributionWallet: string
  amount: string
  treasuryAmount: string
  distributionAmount: string
  moveToRevenueTxSignature: string | null
  treasuryTxSignature: string | null
  distributionTxSignature: string | null
  settlementStatus: string
  settlementError: string | null
  retryCount: number
  retryable: boolean
  lastRetryAt: string | null
  nextRetryAt: string | null
  createdAt: string
  settledAt: string | null
  revenueEvent: {
    type: string
    amount: string
    createdAt: string
    userId: string | null
  }
}

interface WalletBalance {
  address: string | null
  balance: number | null
  error?: string
}

interface SettlementTotals {
  totalEvents: number
  totalAmount: number
  treasuryDue: number
  distributionDue: number
  treasurySettled: number
  distributionSettled: number
  pendingAmount: number
  failedAmount: number
}

interface SummaryData {
  walletBalances: {
    topupWallet: WalletBalance
    revenueWallet: WalletBalance
    treasuryWallet: WalletBalance
    distributionWallet: WalletBalance
    feeCreatorWallet: WalletBalance
  } | null
  board: {
    totalTiles: number
    activeTiles: number
    availableTiles: number
    pendingTiles: number
    activeAds: number
    activeAdvertisers: number
  }
  currentBurn: {
    dailyIncome: number
    tilePrice: number
    freeEnabled: boolean
  }
  epoch: {
    date: string
    advertisingFeesEarned: number
    tradingFeesEarned: number
    grossFees: number
    treasuryFeesGenerated: number
    distributionPoolGenerated: number
    feePercent: number
  }
  settlement: {
    settledToTreasury: number
    settledToDistribution: number
    pendingSettlement: number
    failedSettlement: number
    pendingCount: number
    failedCount: number
  }
}

interface RevenueEventDetailed extends RevenueEvent {
  settlement?: {
    settlementStatus: string
    moveToRevenueTxSignature: string | null
    treasuryTxSignature: string | null
    distributionTxSignature: string | null
  } | null
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
  const [rentals, setRentals] = useState<RentalOrder[]>([])
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
    auto_approve_ads: 'true',
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
  const [showAdvancedEpoch, setShowAdvancedEpoch] = useState(false)
  const [currentEpochData, setCurrentEpochData] = useState<CurrentEpochData | null>(null)
  const [epochCountdown, setEpochCountdown] = useState('')
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null)
  const [reconcileRunning, setReconcileRunning] = useState(false)
  const [txSigInputs, setTxSigInputs] = useState<Record<string, string>>({})
  const [txSigResults, setTxSigResults] = useState<Record<string, TxSigCheckResult>>({})
  const [txSigRunning, setTxSigRunning] = useState<Record<string, boolean>>({})

  interface UserBalanceRow {
    id: string
    walletAddress: string | null
    email: string | null
    balance: number
    rentalCount: number
    topupCount: number
    createdAt: string
    confirmedRealTopups: number
    mockTopups: number
    activeDailyBurn: number
    activeTiles: number
  }
  const [userBalances, setUserBalances] = useState<UserBalanceRow[]>([])
  const [accountingData, setAccountingData] = useState<AccountingData | null>(null)
  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [settlementTotals, setSettlementTotals] = useState<SettlementTotals | null>(null)
  const [retryingSettlement, setRetryingSettlement] = useState<Record<string, boolean>>({})
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [accountingEvents, setAccountingEvents] = useState<RevenueEventDetailed[]>([])
  const [accountingSubview, setAccountingSubview] = useState<'cards' | 'events'>('cards')
  const [repairing, setRepairing] = useState(false)
  const [repairMsg, setRepairMsg] = useState('')
  const [retryAllRunning, setRetryAllRunning] = useState(false)
  const [retryAllResult, setRetryAllResult] = useState<{ retried: number; succeeded: number; failed: number } | null>(null)
  const [prelaunchConfirm, setPrelaunchConfirm] = useState('')
  const [prelaunchRunning, setPrelaunchRunning] = useState(false)
  const [prelaunchResult, setPrelaunchResult] = useState<{
    settlements: number; billingItems: number; revenueEvents: number; claims: number
    holderSnapshots: number; epochs: number; billingRuns: number; rentals: number
    creatives: number; topups: number; processedTxs: number; usersBalancesZeroed: number
  } | null>(null)

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
        setRentals(d.orders ?? [])
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
    } else if (view === 'users') {
      const res = await fetch('/api/admin?view=user_balances')
      if (res.ok) {
        const d = await res.json()
        setUserBalances(d.users ?? [])
      }
    } else if (view === 'accounting') {
      const [accountingRes, eventsRes] = await Promise.all([
        fetch('/api/admin?view=accounting'),
        fetch('/api/admin?view=revenue_events'),
      ])
      if (accountingRes.ok) { const d = await accountingRes.json(); setAccountingData(d) }
      if (eventsRes.ok) { const d = await eventsRes.json(); setAccountingEvents(d.events ?? []) }
    } else if (view === 'settlements') {
      const res = await fetch('/api/admin?view=settlements')
      if (res.ok) {
        const d = await res.json()
        setSettlements(d.settlements ?? [])
        if (d.totals) setSettlementTotals(d.totals)
      }
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  // Load top-level summary whenever admin is authenticated
  useEffect(() => {
    if (!authed) return
    setSummaryLoading(true)
    fetch('/api/admin?view=summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SummaryData | null) => { if (d) setSummaryData(d) })
      .catch(() => {})
      .finally(() => setSummaryLoading(false))
  }, [authed])

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

  const runRepair = async (action: string, extra: Record<string, unknown> = {}) => {
    setRepairing(true)
    setRepairMsg('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const d = await res.json()
      setRepairMsg(d.note ?? d.error ?? (res.ok ? 'Done ✓' : 'Error'))
      if (res.ok) load()
    } catch { setRepairMsg('Network error') }
    finally { setRepairing(false) }
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

  const exportEpochsCsv = () => {
    const headers = ['Date', 'Ad Fees (USDC)', 'Trading Fees (USDC)', 'Gross Fees (USDC)', 'Treasury Fee %', 'Treasury Fee Amount (USDC)', 'Distribution Pool (USDC)', 'Eligible Supply', 'Status']
    const rows = distEpochs.map((ep) => {
      const claimPool = Number(ep.claimPoolAmount || ep.totalPool)
      const ed = new Date(ep.epochDate)
      const dateStr = `${ed.getUTCFullYear()}-${String(ed.getUTCMonth()+1).padStart(2,'0')}-${String(ed.getUTCDate()).padStart(2,'0')}`
      return [dateStr, Number(ep.adRevenue).toFixed(6), Number(ep.tradingFeeRevenue).toFixed(6), Number(ep.grossPool).toFixed(6), Number(ep.managementFeePercent).toFixed(2), Number(ep.managementFeeAmount).toFixed(6), claimPool.toFixed(6), ep.eligibleSupply ?? '0', ep.status]
    })
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `epochs-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
      let d: ReconcileResult
      try {
        d = await res.json()
      } catch {
        d = {
          ok: false, scannedTransactions: 0, usdcTransfersFound: 0, matchedTopups: 0,
          unmatchedDeposits: 0, duplicatesIgnored: 0, expiredTopups: 0,
          errors: [`Server returned HTTP ${res.status} with non-JSON body`], details: [],
        }
      }
      setReconcileResult(d)
      if (res.ok && d.ok) load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setReconcileResult({
        ok: false, scannedTransactions: 0, usdcTransfersFound: 0, matchedTopups: 0,
        unmatchedDeposits: 0, duplicatesIgnored: 0, expiredTopups: 0,
        errors: [`Request failed: ${msg}`], details: [],
      })
    } finally {
      setReconcileRunning(false)
    }
  }

  const checkTxSig = async (topupId: string, overrideSig?: string) => {
    const sig = (overrideSig ?? txSigInputs[topupId])?.trim()
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

      {/* ── Global summary strip ──────────────────────────────────────────────── */}
      <div className="mb-6 border border-white/10 rounded-2xl bg-white/2 p-4 space-y-4">
        {summaryLoading && !summaryData ? (
          <div className="text-white/20 text-xs animate-pulse">Loading summary…</div>
        ) : summaryData ? (
          <>
            {/* Accounting note */}
            <p className="text-[10px] text-white/30 leading-relaxed">
              <span className="text-amber-400/80 font-semibold">Note:</span>{' '}
              Top-ups are prepaid advertiser balances, not revenue. Current Daily Income is the active ad burn rate.
              Advertising Fees Earned is only recognized when a paid 24h period is charged.
            </p>

            {/* Row 1: Board + Burn + Epoch */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {[
                {
                  label: 'Active Tiles',
                  value: summaryData.board.activeTiles.toLocaleString(),
                  sub: `of ${summaryData.board.totalTiles.toLocaleString()} total`,
                  color: summaryData.board.activeTiles > 0 ? 'text-green-400' : 'text-white/40',
                },
                {
                  label: 'Available',
                  value: summaryData.board.availableTiles.toLocaleString(),
                  sub: summaryData.board.pendingTiles > 0 ? `${summaryData.board.pendingTiles} pending` : 'tiles free',
                  color: 'text-white/70',
                },
                {
                  label: 'Active Ads',
                  value: String(summaryData.board.activeAds),
                  sub: `${summaryData.board.activeAdvertisers} advertiser${summaryData.board.activeAdvertisers !== 1 ? 's' : ''}`,
                  color: 'text-white/70',
                },
                {
                  label: 'Daily Income',
                  value: summaryData.currentBurn.freeEnabled ? 'FREE MODE' : `$${summaryData.currentBurn.dailyIncome.toFixed(2)}`,
                  sub: summaryData.currentBurn.freeEnabled ? 'no charges' : `$${summaryData.currentBurn.tilePrice}/tile/day`,
                  color: summaryData.currentBurn.freeEnabled ? 'text-amber-400' : 'text-green-400',
                },
                {
                  label: `Ad Fees Today`,
                  value: `$${summaryData.epoch.advertisingFeesEarned.toFixed(2)}`,
                  sub: `+$${summaryData.epoch.tradingFeesEarned.toFixed(2)} trading`,
                  color: 'text-green-400',
                },
                {
                  label: 'Distribution Pool',
                  value: `$${summaryData.epoch.distributionPoolGenerated.toFixed(2)}`,
                  sub: `$${summaryData.epoch.treasuryFeesGenerated.toFixed(2)} treasury (${summaryData.epoch.feePercent}%)`,
                  color: 'text-blue-400',
                },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="bg-white/3 rounded-xl p-2.5 space-y-0.5">
                  <div className={`font-mono font-bold text-base leading-tight ${color}`}>{value}</div>
                  <div className="text-white/60 text-[10px] font-medium">{label}</div>
                  <div className="text-white/25 text-[10px]">{sub}</div>
                </div>
              ))}
            </div>

            {/* Row 2: Wallet balances */}
            <div>
              <div className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">On-Chain USDC Balances</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {summaryData.walletBalances ? (
                  ([
                    ['Top-Up Wallet', summaryData.walletBalances.topupWallet, 'text-amber-400'],
                    ['Revenue Wallet', summaryData.walletBalances.revenueWallet, 'text-green-400'],
                    ['Treasury Wallet', summaryData.walletBalances.treasuryWallet, 'text-white/70'],
                    ['Distribution', summaryData.walletBalances.distributionWallet, 'text-blue-400'],
                    ['Fee Creator', summaryData.walletBalances.feeCreatorWallet, 'text-white/70'],
                  ] as [string, WalletBalance, string][]).map(([label, wb, color]) => (
                    <div key={label} className="bg-white/3 rounded-xl px-3 py-2 space-y-0.5">
                      <div className={`font-mono font-bold text-sm ${wb.balance !== null ? color : 'text-white/20'}`}>
                        {wb.address === null ? '—' : wb.balance !== null ? `$${wb.balance.toFixed(2)}` : 'Unavail.'}
                      </div>
                      <div className="text-white/50 text-[10px]">{label}</div>
                      {wb.error && (
                        <div className="text-red-400/60 text-[9px] truncate" title={wb.error}>err: {wb.error.slice(0, 30)}</div>
                      )}
                      {wb.address && (
                        <div className="text-white/20 text-[9px] font-mono">{wb.address.slice(0, 4)}…{wb.address.slice(-4)}</div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="col-span-5 text-white/20 text-xs">Wallet balances unavailable</div>
                )}
              </div>
            </div>

            {/* Row 3: Settlement state */}
            {(summaryData.settlement.pendingCount > 0 || summaryData.settlement.failedCount > 0 || summaryData.settlement.settledToTreasury > 0) && (
              <div className="flex flex-wrap gap-3 text-xs">
                {summaryData.settlement.failedCount > 0 && (
                  <span className="bg-red-500/10 border border-red-500/20 text-red-400 px-2.5 py-1 rounded-full">
                    {summaryData.settlement.failedCount} failed settlement{summaryData.settlement.failedCount !== 1 ? 's' : ''} — ${summaryData.settlement.failedSettlement.toFixed(2)} stuck
                  </span>
                )}
                {summaryData.settlement.pendingCount > 0 && (
                  <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full">
                    {summaryData.settlement.pendingCount} pending — ${summaryData.settlement.pendingSettlement.toFixed(2)}
                  </span>
                )}
                {summaryData.settlement.settledToTreasury > 0 && (
                  <span className="bg-white/5 border border-white/10 text-white/40 px-2.5 py-1 rounded-full">
                    Treasury: ${summaryData.settlement.settledToTreasury.toFixed(2)} · Distribution: ${summaryData.settlement.settledToDistribution.toFixed(2)} settled
                  </span>
                )}
                <button
                  onClick={() => {
                    setSummaryLoading(true)
                    fetch('/api/admin?view=summary')
                      .then((r) => (r.ok ? r.json() : null))
                      .then((d: SummaryData | null) => { if (d) setSummaryData(d) })
                      .catch(() => {})
                      .finally(() => setSummaryLoading(false))
                  }}
                  className="text-white/20 hover:text-white/50 text-[10px] transition-colors"
                >
                  ↻ refresh
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-0 flex-wrap">
        {(['pending', 'active', 'billing', 'accounting', 'settlements', 'epochs', 'distribution', 'pricing', 'topups', 'users', 'reset'] as AdminView[]).map((v) => (
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
              : v === 'accounting' ? 'Accounting'
              : v === 'settlements' ? 'Settlements'
              : v === 'epochs' ? 'Epochs (legacy)'
              : v === 'distribution' ? 'Distribution'
              : v === 'pricing' ? 'Pricing Settings'
              : v === 'topups' ? 'Top-ups'
              : v === 'users' ? 'Users'
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
                <>
                  {/* Totals summary bar */}
                  {(() => {
                    const totalTiles = rentals.reduce((s, o) => s + o.tileCount, 0)
                    const totalDaily = rentals.reduce((s, o) => s + o.dailyRateTotal, 0)
                    const avgDaily = rentals.length > 0 ? totalDaily / rentals.length : 0
                    return (
                      <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-green-400/5 border border-green-400/20 rounded-xl text-xs">
                        <span className="text-white/50">
                          <span className="text-white font-bold">{rentals.length}</span> active order{rentals.length !== 1 ? 's' : ''}
                        </span>
                        <span className="text-white/30">·</span>
                        <span className="text-white/50">
                          <span className="text-green-400 font-bold">{totalTiles}</span> tiles rented
                        </span>
                        <span className="text-white/30">·</span>
                        <span className="text-white/50">
                          <span className="text-green-400 font-bold">${totalDaily.toFixed(2)}</span>/day total
                        </span>
                        <span className="text-white/30">·</span>
                        <span className="text-white/50">
                          avg <span className="text-white font-mono">${avgDaily.toFixed(2)}</span>/day per order
                        </span>
                      </div>
                    )
                  })()}
                  {rentals.map((order) => (
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
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-400/10 text-green-400">
                        LIVE
                      </span>
                    </div>

                    {/* Order details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
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
                            Live since: {order.startDate ? new Date(order.startDate).toLocaleString() : new Date(order.createdAt).toLocaleString()}
                          </div>
                          {order.nextBillingAt && (
                            <div className="text-white/20 text-[10px] font-mono mt-0.5">
                              Next billing: {new Date(order.nextBillingAt).toLocaleString()}
                            </div>
                          )}
                          {order.lastBilledAt && (
                            <div className="text-white/20 text-[10px] font-mono">
                              Last billed: {new Date(order.lastBilledAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => act('remove_order', { creativeId: order.creativeId ?? '' })}
                            className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 text-xs px-3 py-1.5 rounded transition-colors"
                          >
                            Remove Ad
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

          {view === 'billing' && (
            <div className="space-y-4">
              <div className="border border-white/5 bg-white/2 rounded-xl px-4 py-3 text-[10px] text-white/40 leading-relaxed">
                <span className="text-amber-300/70 font-semibold">Renewal Billing History</span> — This table shows historical renewal billing runs (recurring 24h charges on existing active ads).
                It does <em>not</em> include first-24h activation charges, which are deducted immediately when an ad is approved.
                For all revenue events (including activation charges), see the <button onClick={() => { setView('accounting'); setAccountingSubview('events') }} className="text-amber-400 hover:text-amber-300 underline transition-colors">Accounting → Revenue Events</button> tab.
              </div>
              {billingRuns.length === 0 ? (
                <div className="text-white/30 text-sm text-center py-12">
                  No billing runs yet. Click &quot;Run daily billing&quot; above.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
                      <th className="pb-2 text-left font-medium">Date</th>
                      <th className="pb-2 text-right font-medium">Tiles Billed</th>
                      <th className="pb-2 text-right font-medium">Revenue Recognized</th>
                      <th className="pb-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingRuns.map((r) => (
                      <tr key={r.id} className="border-b border-white/5">
                        <td className="py-3 text-white/70">{new Date(r.runDate).toLocaleDateString()}</td>
                        <td className="py-3 text-right font-mono text-white/70">{r.tilesCharged}</td>
                        <td className="py-3 text-right font-mono text-green-400" title="AD_RENT_REVENUE from this renewal run">
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
            <div className="space-y-4">
              <div className="border border-white/5 rounded-xl p-4 bg-white/2">
                <p className="text-white/50 text-sm">
                  Epochs are created automatically each UTC calendar day.{' '}
                  <button onClick={() => setView('distribution')} className="text-amber-400 hover:text-amber-300 underline transition-colors">
                    Use the Distribution tab
                  </button>{' '}
                  to manage epochs, run snapshots, and publish claim pools.
                </p>
              </div>

              {/* Advanced / Developer section */}
              <div className="border border-white/5 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowAdvancedEpoch((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs text-white/30 hover:text-white/50 transition-colors"
                >
                  <span className="uppercase tracking-widest">Advanced / Developer</span>
                  <span>{showAdvancedEpoch ? '▲' : '▼'}</span>
                </button>
                {showAdvancedEpoch && (
                  <div className="px-4 pb-4 space-y-5 border-t border-white/5">
                    <div className="pt-4">
                      <h3 className="text-sm font-bold text-white mb-1">Create epoch manually</h3>
                      <p className="text-white/30 text-xs mb-3">Only for testing or recovery. Daily epochs are auto-created.</p>
                      <form onSubmit={createEpoch} className="flex gap-3">
                        <input
                          type="number" min="0" step="0.01"
                          value={epochForm.totalPool}
                          onChange={(e) => setEpochForm({ totalPool: e.target.value })}
                          placeholder="Total pool (USDC)"
                          className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                        />
                        <button type="submit" disabled={!epochForm.totalPool}
                          className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-sm px-4 py-2 rounded transition-colors disabled:opacity-50">
                          Create
                        </button>
                      </form>
                    </div>
                    <div className="pt-2 border-t border-white/5">
                      <h3 className="text-sm font-bold text-white mb-1">Mock holder snapshot</h3>
                      <p className="text-white/30 text-xs mb-3">Enter wallets as &quot;wallet_address:token_balance&quot; per line.</p>
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
                        <button type="submit" disabled={!snapshotForm.epochId}
                          className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-xs px-4 py-2 rounded transition-colors disabled:opacity-50">
                          Take snapshot
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
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
                          <div className="flex items-center gap-2">
                            <a
                              href={`https://solscan.io/tx/${t.txSignature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-400/70 hover:text-blue-400 font-mono"
                            >
                              {t.txSignature.slice(0, 20)}… ↗
                            </a>
                            <button
                              onClick={() => checkTxSig(t.id, t.txSignature ?? undefined)}
                              disabled={!!txSigRunning[t.id]}
                              className="text-[10px] bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-400 px-2 py-0.5 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                            >
                              {txSigRunning[t.id] ? '…' : 'Check stored tx'}
                            </button>
                          </div>
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
                      Treasury fee (%)
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

                <div className="border border-white/10 rounded-xl p-5 bg-white/2 space-y-4">
                  <h3 className="text-sm font-bold text-white">Ad Moderation</h3>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="auto-approve-ads"
                      checked={pricingForm.auto_approve_ads !== 'false'}
                      onChange={(e) =>
                        setPricingForm((f) => ({ ...f, auto_approve_ads: e.target.checked ? 'true' : 'false' }))
                      }
                      className="w-4 h-4 accent-amber-400"
                    />
                    <label htmlFor="auto-approve-ads" className="text-sm text-white/70 cursor-pointer">
                      Auto-approve ads (go live immediately)
                    </label>
                  </div>
                  <p className="text-white/30 text-xs">
                    When ON, ads submitted by advertisers go live immediately. When OFF, they go to Pending Approval for manual review.
                  </p>
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
                    const boardMint = process.env.NEXT_PUBLIC_BOARD_MINT ?? ''
                    const hasBoardMint = !!boardMint
                    const ceStatusColor =
                      ce.status === 'OPEN' ? 'text-cyan-400 bg-cyan-400/10'
                      : ce.status === 'PUBLISHED' ? 'text-green-400 bg-green-400/10'
                      : ce.status === 'READY_NO_TOKEN' ? 'text-purple-400 bg-purple-400/10'
                      : ce.status === 'FAILED' ? 'text-red-400 bg-red-400/10'
                      : 'text-amber-400 bg-amber-400/10'
                    return (
                      <div className="border border-amber-400/30 bg-amber-400/5 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <div className="text-[10px] text-amber-400/60 uppercase tracking-widest mb-0.5">Current UTC Epoch</div>
                            <div className="text-white font-bold">{dateStr}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ceStatusColor}`}>{ce.status}</span>
                            <div className="text-right">
                              <div className="text-[10px] text-white/30 uppercase tracking-widest mb-0.5">Closes in</div>
                              <div className="font-mono text-amber-400 font-bold">{epochCountdown}</div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                          {[
                            { label: 'Advertising fees', v: lr.adRevenue, color: 'text-green-400' },
                            { label: 'Trading fees', v: lr.tradingFeeRevenue, color: 'text-blue-400' },
                            { label: 'Gross fees', v: lr.grossPool, color: 'text-white' },
                            { label: `Treasury fee (${lr.feePercent}%)`, v: lr.estimatedMgmtFee, color: 'text-white/50' },
                            { label: 'Balance to distribute', v: lr.estimatedClaimPool, color: 'text-green-400' },
                          ].map(({ label, v, color }) => (
                            <div key={label} className="bg-white/3 rounded p-2">
                              <div className={`font-mono font-bold ${color}`}>${v.toFixed(2)}</div>
                              <div className="text-white/30 text-[10px]">{label}</div>
                            </div>
                          ))}
                          <div className="bg-white/3 rounded p-2">
                            <div className={`font-mono font-bold text-xs ${hasBoardMint ? 'text-green-400' : 'text-white/30'}`}>
                              {hasBoardMint ? '✓ configured' : '✗ not set'}
                            </div>
                            <div className="text-white/30 text-[10px]">$BOARD mint</div>
                          </div>
                        </div>

                        {!hasBoardMint && (
                          <p className="text-xs text-purple-400/60">$BOARD mint not configured. Revenue is tracked; holder snapshots require NEXT_PUBLIC_BOARD_MINT.</p>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                          <button onClick={load} className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/60 px-3 py-1.5 rounded transition-colors">
                            Refresh
                          </button>
                          <button onClick={runBilling} disabled={billingRunning} className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded transition-colors disabled:opacity-50">
                            {billingRunning ? 'Running…' : 'Run Billing'}
                          </button>
                          <button onClick={() => runDistributionAction('trigger_close_epoch')} className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded transition-colors">
                            Close Yesterday&apos;s Epoch
                          </button>
                          <button onClick={() => runDistributionAction('seed_excluded_wallets')} className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/50 px-3 py-1.5 rounded transition-colors">
                            Seed Excluded Wallets
                          </button>
                          <button onClick={exportEpochsCsv} disabled={distEpochs.length === 0} className="text-xs bg-white/5 hover:bg-white/10 border border-white/20 text-white/50 px-3 py-1.5 rounded transition-colors disabled:opacity-40">
                            Export CSV
                          </button>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Epoch history table */}
                  {distEpochs.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-8">No epochs yet. The current UTC epoch auto-creates on first billing.</p>
                  ) : (
                    <div>
                      <h3 className="text-xs text-white/40 uppercase tracking-widest mb-3">Epoch History</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-white/30 uppercase tracking-widest border-b border-white/10">
                              <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Date</th>
                              <th className="pb-2 text-right font-medium px-2 whitespace-nowrap">Ad Fees</th>
                              <th className="pb-2 text-right font-medium px-2 whitespace-nowrap">Trading Fees</th>
                              <th className="pb-2 text-right font-medium px-2 whitespace-nowrap">Gross</th>
                              <th className="pb-2 text-right font-medium px-2 whitespace-nowrap">Treas %</th>
                              <th className="pb-2 text-right font-medium px-2 whitespace-nowrap">Treas $</th>
                              <th className="pb-2 text-right font-medium px-2 whitespace-nowrap">To Distribute</th>
                              <th className="pb-2 text-right font-medium px-2 whitespace-nowrap">Supply</th>
                              <th className="pb-2 text-center font-medium px-2 whitespace-nowrap">Status</th>
                              <th className="pb-2 text-right font-medium pl-2 whitespace-nowrap">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {distEpochs.map((ep) => {
                              const gross = Number(ep.grossPool)
                              const claimPool = Number(ep.claimPoolAmount || ep.totalPool)
                              const ed = new Date(ep.epochDate)
                              const epDateStr = `${ed.getUTCFullYear()}-${String(ed.getUTCMonth()+1).padStart(2,'0')}-${String(ed.getUTCDate()).padStart(2,'0')}`
                              const epStatusColor =
                                ep.status === 'PUBLISHED' ? 'text-green-400 bg-green-400/10'
                                : ep.status === 'CLOSED' ? 'text-white/30 bg-white/5'
                                : ep.status === 'SNAPSHOTTED' ? 'text-blue-400 bg-blue-400/10'
                                : ep.status === 'BILLED' ? 'text-amber-400 bg-amber-400/10'
                                : ep.status === 'OPEN' ? 'text-cyan-400 bg-cyan-400/10'
                                : ep.status === 'PROCESSING' ? 'text-yellow-400 bg-yellow-400/10'
                                : ep.status === 'FAILED' ? 'text-red-400 bg-red-400/10'
                                : ep.status === 'READY_NO_TOKEN' ? 'text-purple-400 bg-purple-400/10'
                                : 'text-white/50 bg-white/5'
                              const boardMintSet = !!(process.env.NEXT_PUBLIC_BOARD_MINT ?? '')
                              return (
                                <tr key={ep.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                  <td className="py-2 pr-3 text-white font-medium whitespace-nowrap">{epDateStr}</td>
                                  <td className="py-2 px-2 text-right font-mono text-green-400 whitespace-nowrap">${Number(ep.adRevenue).toFixed(2)}</td>
                                  <td className="py-2 px-2 text-right font-mono text-blue-400 whitespace-nowrap">${Number(ep.tradingFeeRevenue).toFixed(2)}</td>
                                  <td className="py-2 px-2 text-right font-mono text-white whitespace-nowrap">{gross > 0 ? `$${gross.toFixed(2)}` : '—'}</td>
                                  <td className="py-2 px-2 text-right font-mono text-white/50 whitespace-nowrap">{Number(ep.managementFeePercent).toFixed(0)}%</td>
                                  <td className="py-2 px-2 text-right font-mono text-white/50 whitespace-nowrap">{gross > 0 ? `$${Number(ep.managementFeeAmount).toFixed(2)}` : '—'}</td>
                                  <td className="py-2 px-2 text-right font-mono text-green-400 whitespace-nowrap">{gross > 0 ? `$${claimPool.toFixed(2)}` : '—'}</td>
                                  <td className="py-2 px-2 text-right font-mono text-white/40 whitespace-nowrap">{ep.eligibleSupply && Number(ep.eligibleSupply) > 0 ? Number(ep.eligibleSupply).toLocaleString() : '—'}</td>
                                  <td className="py-2 px-2 text-center whitespace-nowrap">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${epStatusColor}`}>{ep.status}</span>
                                  </td>
                                  <td className="py-2 pl-2 text-right">
                                    <div className="flex items-center justify-end gap-1 flex-wrap">
                                      {(ep.status === 'DRAFT' || ep.status === 'OPEN' || ep.status === 'FAILED' || ep.status === 'BILLED') && (
                                        <button onClick={() => runDistributionAction('calculate_pool', { epochId: ep.id })} className="text-[10px] bg-white/10 hover:bg-white/20 text-white/70 px-2 py-0.5 rounded transition-colors">
                                          Recalculate
                                        </button>
                                      )}
                                      {(ep.status === 'BILLED' || ep.status === 'DRAFT' || ep.status === 'OPEN') && (
                                        <button onClick={() => runRealSnapshot(ep.id)} disabled={snapshotRunning || !boardMintSet} title={!boardMintSet ? 'NEXT_PUBLIC_BOARD_MINT not configured' : undefined} className="text-[10px] bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-400 px-2 py-0.5 rounded transition-colors disabled:opacity-40">
                                          {snapshotRunning ? '…' : 'Snapshot'}
                                        </button>
                                      )}
                                      {ep.status === 'SNAPSHOTTED' && (
                                        <button onClick={() => runDistributionAction('publish_epoch', { epochId: ep.id })} className="text-[10px] bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 px-2 py-0.5 rounded transition-colors">
                                          Publish
                                        </button>
                                      )}
                                      {ep.status === 'PUBLISHED' && (
                                        <button onClick={() => runDistributionAction('close_epoch', { epochId: ep.id })} className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/20 text-white/40 px-2 py-0.5 rounded transition-colors">
                                          Close
                                        </button>
                                      )}
                                      {ep.status === 'FAILED' && (
                                        <button onClick={() => runDistributionAction('trigger_close_epoch', { epochDate: ep.epochDate })} className="text-[10px] bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 px-2 py-0.5 rounded transition-colors">
                                          Retry
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
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

          {view === 'users' && (
            <div className="space-y-4">
              <div className="text-xs text-white/40 mb-2">
                Advertiser accounts — internal USDC balance, real vs mock topups, active burn rate.
              </div>
              {userBalances.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-8">No advertiser accounts found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/30 uppercase tracking-widest border-b border-white/10">
                        <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Wallet</th>
                        <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Email</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Balance</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Real Topups</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Mock Topups</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Daily Burn</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Tiles</th>
                        <th className="pb-2 text-right font-medium whitespace-nowrap">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userBalances.map((u) => (
                        <tr key={u.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                          <td className="py-2 pr-3">
                            {u.walletAddress ? (
                              <span className="font-mono text-green-400/80">
                                {u.walletAddress.slice(0, 6)}…{u.walletAddress.slice(-4)}
                              </span>
                            ) : (
                              <span className="text-white/20 italic">none</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-white/50 truncate max-w-[140px]">{u.email ?? '—'}</td>
                          <td className={`py-2 pr-3 text-right font-mono font-bold ${u.balance > 0 ? 'text-green-400' : 'text-white/30'}`}>
                            ${u.balance.toFixed(2)}
                          </td>
                          <td className={`py-2 pr-3 text-right font-mono ${u.confirmedRealTopups > 0 ? 'text-white/70' : 'text-white/20'}`}>
                            {u.confirmedRealTopups > 0 ? `$${u.confirmedRealTopups.toFixed(2)}` : '—'}
                          </td>
                          <td className={`py-2 pr-3 text-right font-mono ${u.mockTopups > 0 ? 'text-amber-400/70' : 'text-white/20'}`}>
                            {u.mockTopups > 0 ? `$${u.mockTopups.toFixed(2)}` : '—'}
                          </td>
                          <td className={`py-2 pr-3 text-right font-mono ${u.activeDailyBurn > 0 ? 'text-green-400/70' : 'text-white/20'}`}>
                            {u.activeDailyBurn > 0 ? `$${u.activeDailyBurn.toFixed(2)}/d` : '—'}
                          </td>
                          <td className={`py-2 pr-3 text-right font-mono ${u.activeTiles > 0 ? 'text-white/60' : 'text-white/20'}`}>
                            {u.activeTiles > 0 ? u.activeTiles : '—'}
                          </td>
                          <td className="py-2 text-right text-white/30">{new Date(u.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {view === 'accounting' && (
            <div className="space-y-5">
              {/* Info banner */}
              <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl px-4 py-3 text-xs text-amber-300/80">
                <span className="font-bold text-amber-300">Accounting note:</span> Top-Up Wallet holds advertiser prepaid balances.
                Only earned billed fees should move to Revenue Wallet. Never distribute unused advertiser deposits.
              </div>

              {!accountingData ? (
                <p className="text-white/30 text-sm text-center py-8">Loading accounting data…</p>
              ) : (
                <>
                  {/* ── Reconciliation panel ────────────────────────────────── */}
                  {(() => {
                    const rec = accountingData.reconciliation
                    const hasMismatch = rec.variance !== null && Math.abs(rec.variance) > 0.01
                    const onChainLow = rec.variance !== null && rec.variance < -0.01
                    return (
                      <div className={`border rounded-xl p-4 space-y-3 ${hasMismatch ? 'border-red-500/40 bg-red-500/5' : 'border-white/10 bg-white/2'}`}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest">
                            {hasMismatch ? '⚠ Accounting Reconciliation — MISMATCH DETECTED' : 'Accounting Reconciliation'}
                          </h3>
                          <span className="text-[10px] text-white/20">Expected = advertiser balances + unsettled earned fees</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          {[
                            { label: 'Unused Advertiser Balances', value: `$${accountingData.unusedAdvertiserBalances.toFixed(2)}`, color: 'text-amber-400' },
                            { label: 'Earned Not Yet Moved', value: `$${rec.earnedNotYetMoved.toFixed(2)}`, color: 'text-white/70', note: 'Unsettled/failed settlement amounts' },
                            { label: 'Expected Top-Up Wallet', value: `$${rec.expectedTopupWalletBalance.toFixed(2)}`, color: 'text-white/80' },
                            {
                              label: 'Actual On-Chain Balance',
                              value: rec.topupWalletOnChain !== null ? `$${rec.topupWalletOnChain.toFixed(2)}` : 'Unavailable',
                              color: onChainLow ? 'text-red-400' : 'text-green-400',
                            },
                          ].map(({ label, value, color, note }) => (
                            <div key={label} className="bg-white/3 rounded-lg p-2">
                              <div className={`font-mono font-bold text-sm ${color}`}>{value}</div>
                              <div className="text-white/40 text-[10px] mt-0.5">{label}</div>
                              {note && <div className="text-white/20 text-[9px]">{note}</div>}
                            </div>
                          ))}
                        </div>
                        {rec.variance !== null && (
                          <div className={`text-xs font-mono px-3 py-1.5 rounded ${hasMismatch ? 'bg-red-500/10 text-red-300' : 'bg-green-500/10 text-green-400'}`}>
                            Variance: {rec.variance >= 0 ? '+' : ''}{rec.variance.toFixed(4)} USDC
                            {hasMismatch && ' — App balances exceed on-chain funds. Reconciliation required before launch.'}
                            {!hasMismatch && ' — Balanced ✓'}
                          </div>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-white/40 pt-1 border-t border-white/5">
                          <span>Real on-chain topups: <span className="text-white/60">${rec.confirmedOnChainTopups.toFixed(2)}</span></span>
                          <span>Mock/test topups: <span className={`${rec.mockTopups > 0 ? 'text-amber-400/70' : 'text-white/60'}`}>${rec.mockTopups.toFixed(2)}</span></span>
                          <span>Active tiles: <span className="text-white/60">{rec.activeTileCount}</span></span>
                          <span>Daily burn: <span className="text-white/60">${rec.activeDailyBurn.toFixed(2)}/day</span></span>
                        </div>
                      </div>
                    )
                  })()}

                  {/* ── Repair tools ─────────────────────────────────────────── */}
                  <div className="border border-amber-500/20 rounded-xl p-4 space-y-3">
                    <h3 className="text-xs font-bold text-amber-400/80 uppercase tracking-widest">Repair Tools</h3>
                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={repairing}
                        onClick={() => runRepair('backfill_activation_charges')}
                        className="text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                      >
                        Backfill Activation Charges
                      </button>
                      <button
                        disabled={repairing}
                        onClick={() => runRepair('audit_settlement_coverage')}
                        className="text-xs bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-400 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                      >
                        Audit Settlement Coverage
                      </button>
                    </div>
                    {repairMsg && (
                      <div className={`text-xs px-3 py-2 rounded font-mono ${repairMsg.includes('Error') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                        {repairMsg}
                      </div>
                    )}
                    <p className="text-[10px] text-white/25">
                      <strong>Backfill:</strong> For ACTIVE ads missing a first-24h charge, deducts balance and creates AD_RENT_REVENUE.
                      Idempotent — never double-charges. Suspends ads with insufficient balance.{' '}
                      <strong>Audit:</strong> Creates UNSETTLED settlement rows for any AD_RENT_REVENUE events that have no settlement record.
                    </p>
                  </div>

                  {/* Balance health check */}
                  {(() => {
                    const hasFailures = accountingData.failedSettlements > 0
                    return hasFailures ? (
                      <div className="border border-red-500/40 bg-red-500/5 rounded-xl px-4 py-3 text-xs text-red-300">
                        <span className="font-bold">Settlement warning:</span> {accountingData.failedSettlements} failed/partial settlement{accountingData.failedSettlements !== 1 ? 's' : ''}. Check the Settlements tab to retry.
                        <br /><span className="text-red-300/60 mt-1 block">Note: the active ad and advertiser balance deduction are preserved. Only the on-chain transfer failed.</span>
                      </div>
                    ) : null
                  })()}

                  {/* Main accounting cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      {
                        label: 'Advertising Fees Earned',
                        value: `$${accountingData.earnedAdFees.toFixed(2)}`,
                        sub: accountingData.earnedTradingFees > 0 ? `+$${accountingData.earnedTradingFees.toFixed(2)} trading fees` : 'AD_RENT_REVENUE (billed)',
                        color: 'text-green-400',
                      },
                      {
                        label: `Treasury Fee Generated (${accountingData.feePercent}%)`,
                        value: `$${accountingData.totalTreasuryGenerated.toFixed(2)}`,
                        sub: `${accountingData.feePercent}% of earned — due to TREASURY_WALLET`,
                        color: 'text-white/80',
                      },
                      {
                        label: `Distribution Pool Generated (${100 - accountingData.feePercent}%)`,
                        value: `$${accountingData.totalDistributionGenerated.toFixed(2)}`,
                        sub: `${100 - accountingData.feePercent}% of earned — due to DISTRIBUTION_WALLET`,
                        color: 'text-blue-400',
                      },
                      {
                        label: 'Treasury Sent (on-chain)',
                        value: `$${accountingData.treasurySent.toFixed(2)}`,
                        sub: accountingData.totalTreasuryGenerated > 0
                          ? `${((accountingData.treasurySent / accountingData.totalTreasuryGenerated) * 100).toFixed(0)}% of generated settled`
                          : 'To TREASURY_WALLET',
                        color: accountingData.treasurySent >= accountingData.totalTreasuryGenerated && accountingData.totalTreasuryGenerated > 0 ? 'text-green-400' : 'text-white/50',
                      },
                      {
                        label: 'Distribution Sent (on-chain)',
                        value: `$${accountingData.distributionSent.toFixed(2)}`,
                        sub: accountingData.totalDistributionGenerated > 0
                          ? `${((accountingData.distributionSent / accountingData.totalDistributionGenerated) * 100).toFixed(0)}% of generated settled`
                          : 'To DISTRIBUTION_WALLET',
                        color: accountingData.distributionSent >= accountingData.totalDistributionGenerated && accountingData.totalDistributionGenerated > 0 ? 'text-green-400' : 'text-white/50',
                      },
                      {
                        label: 'Pending Settlement',
                        value: `$${accountingData.pendingAmount.toFixed(2)}`,
                        sub: `${accountingData.pendingSettlements} event${accountingData.pendingSettlements !== 1 ? 's' : ''} generated but not yet sent`,
                        color: accountingData.pendingAmount > 0 ? 'text-amber-400' : 'text-white/30',
                      },
                      {
                        label: 'Failed Settlement',
                        value: `$${accountingData.failedAmount.toFixed(2)}`,
                        sub: `${accountingData.failedSettlements} FAILED / PARTIAL — needs retry`,
                        color: accountingData.failedAmount > 0 ? 'text-red-400' : 'text-white/30',
                      },
                      {
                        label: 'Unused Advertiser Balances',
                        value: `$${accountingData.unusedAdvertiserBalances.toFixed(2)}`,
                        sub: 'Prepaid deposits not yet billed',
                        color: 'text-amber-400',
                      },
                    ].map(({ label, value, sub, color }) => (
                      <div key={label} className="border border-white/10 rounded-xl p-3 bg-white/2 space-y-0.5">
                        <div className={`font-mono font-bold text-lg ${color}`}>{value}</div>
                        <div className="text-white/70 text-xs font-medium">{label}</div>
                        <div className="text-white/25 text-[10px]">{sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Wallet config status */}
                  <div className="border border-white/10 rounded-xl p-4 bg-white/2 space-y-3">
                    <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest">Wallet Configuration</h3>

                    {/* Address-only wallets */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {[
                        { label: 'Treasury Wallet', addr: accountingData.walletConfig.treasuryWallet },
                        { label: 'Distribution Wallet', addr: accountingData.walletConfig.distributionWallet },
                        { label: 'Admin Wallet', addr: accountingData.walletConfig.adminWallet },
                      ].map(({ label, addr }) => (
                        <div key={label} className="flex items-center justify-between gap-2 bg-white/3 rounded px-3 py-1.5">
                          <span className="text-white/40">{label}</span>
                          <span className={`font-mono text-[10px] ${addr ? 'text-white/50' : 'text-red-400/50'}`}>
                            {addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'not set'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Signer wallets with key diagnostics */}
                    <div className="space-y-2 text-xs">
                      {([
                        { label: 'Top-Up Wallet', addr: accountingData.walletConfig.topupWallet, diag: accountingData.walletConfig.topupKeyDiag },
                        { label: 'Revenue Wallet', addr: accountingData.walletConfig.revenueWallet, diag: accountingData.walletConfig.revenueKeyDiag },
                        { label: 'Fee Creator Wallet', addr: accountingData.walletConfig.feeCreatorWallet, diag: accountingData.walletConfig.feeCreatorKeyDiag },
                      ] as { label: string; addr: string | null; diag: KeyDiagnostic }[]).map(({ label, addr, diag }) => {
                        const parseOk = diag.parseStatus === 'ok'
                        const parseErr = diag.parseStatus === 'parse_error'
                        const missing = diag.parseStatus === 'missing'
                        return (
                          <div key={label} className="bg-white/3 rounded px-3 py-2 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-white/50">{label}</span>
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                {/* Key present badge */}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${diag.present ? 'bg-white/10 text-white/50' : 'bg-amber-500/15 text-amber-400/70'}`}>
                                  {diag.present ? 'key set' : 'no key'}
                                </span>
                                {/* Parse status */}
                                {diag.present && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${parseOk ? 'bg-green-500/15 text-green-400' : parseErr ? 'bg-red-500/20 text-red-400' : ''}`}>
                                    {parseOk ? 'parse ✓' : parseErr ? 'parse ✗' : ''}
                                  </span>
                                )}
                                {/* Match status */}
                                {parseOk && diag.matches !== null && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${diag.matches ? 'bg-green-500/20 text-green-400' : 'bg-red-500/25 text-red-400 font-bold'}`}>
                                    {diag.matches ? 'match ✓' : 'MISMATCH ✗'}
                                  </span>
                                )}
                                {/* Address */}
                                <span className={`font-mono text-[10px] ${addr ? 'text-white/50' : 'text-red-400/50'}`}>
                                  {addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'not set'}
                                </span>
                              </div>
                            </div>
                            {/* Derived pubkey (if key parses and no mismatch) */}
                            {parseOk && diag.derivedPubkey && !missing && (
                              <div className="flex items-center gap-2 text-[10px] text-white/30">
                                <span>Derived:</span>
                                <span className="font-mono">{diag.derivedPubkey}</span>
                                <span className="text-white/15">→</span>
                                <span>Expected:</span>
                                <span className="font-mono">{diag.expectedPubkey ?? '—'}</span>
                              </div>
                            )}
                            {/* Error message */}
                            {diag.error && (
                              <div className={`text-[10px] leading-snug rounded px-2 py-1.5 ${diag.matches === false ? 'bg-red-500/10 text-red-400/80 border border-red-500/20' : 'bg-amber-500/10 text-amber-400/80 border border-amber-500/15'}`}>
                                {diag.error}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {(!accountingData.walletConfig.topupWalletKeyConfigured || !accountingData.walletConfig.revenueWalletKeyConfigured) && (
                      <p className="text-amber-400/60 text-[10px]">
                        Settlement private keys not configured — automated on-chain transfers are disabled.
                        Set TOPUP_WALLET_PRIVATE_KEY and REVENUE_WALLET_PRIVATE_KEY to enable. Phantom base58 exports are supported.
                      </p>
                    )}
                  </div>

                  {/* Sub-tab toggle */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAccountingSubview('cards')}
                      className={`text-xs px-3 py-1.5 rounded transition-colors ${accountingSubview === 'cards' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-white/5 text-white/40 hover:text-white border border-white/10'}`}
                    >
                      Summary Cards
                    </button>
                    <button
                      onClick={() => setAccountingSubview('events')}
                      className={`text-xs px-3 py-1.5 rounded transition-colors ${accountingSubview === 'events' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-white/5 text-white/40 hover:text-white border border-white/10'}`}
                    >
                      Revenue Events ({accountingEvents.length})
                    </button>
                    <button onClick={load} className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 px-4 py-2 rounded transition-colors ml-auto">
                      Refresh
                    </button>
                  </div>

                  {accountingSubview === 'events' && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-white/30">
                        All revenue events — AD_RENT_REVENUE includes both activation and renewal charges.
                        TOPUP_DEPOSIT is prepaid balance, not revenue.
                      </p>
                      {accountingEvents.length === 0 ? (
                        <p className="text-white/20 text-xs text-center py-8">No revenue events yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-white/30 uppercase tracking-widest border-b border-white/10">
                                <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Date</th>
                                <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Type</th>
                                <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Amount</th>
                                <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Source</th>
                                <th className="pb-2 text-center font-medium pr-3 whitespace-nowrap">Settlement</th>
                                <th className="pb-2 text-left font-medium whitespace-nowrap">Txs</th>
                              </tr>
                            </thead>
                            <tbody>
                              {accountingEvents.map((ev) => {
                                const isRevenue = ev.type === 'AD_RENT_REVENUE' || ev.type === 'TRADING_FEE_REVENUE'
                                const isDeposit = ev.type === 'TOPUP_DEPOSIT'
                                const settlStatus = ev.settlement?.settlementStatus
                                const settleColor = settlStatus === 'SETTLED' ? 'text-green-400 bg-green-400/10'
                                  : settlStatus === 'FAILED' ? 'text-red-400 bg-red-400/10'
                                  : settlStatus === 'PARTIAL' ? 'text-amber-400 bg-amber-400/10'
                                  : settlStatus ? 'text-blue-400 bg-blue-400/10'
                                  : 'text-white/20 bg-white/5'
                                return (
                                  <tr key={ev.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                    <td className="py-2 pr-3 text-white/40 whitespace-nowrap">
                                      {new Date(ev.createdAt).toLocaleDateString()}
                                      <div className="text-[9px] text-white/20">{new Date(ev.createdAt).toLocaleTimeString()}</div>
                                    </td>
                                    <td className="py-2 pr-3">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                                        ev.type === 'AD_RENT_REVENUE' ? 'text-green-400 bg-green-400/10'
                                        : ev.type === 'TRADING_FEE_REVENUE' ? 'text-blue-400 bg-blue-400/10'
                                        : ev.type === 'TOPUP_DEPOSIT' ? 'text-amber-400/70 bg-amber-400/10'
                                        : 'text-white/40 bg-white/5'
                                      }`}>
                                        {ev.type === 'AD_RENT_REVENUE' ? 'AD_RENT'
                                          : ev.type === 'TRADING_FEE_REVENUE' ? 'TRADING_FEE'
                                          : ev.type === 'TOPUP_DEPOSIT' ? 'TOPUP (not revenue)'
                                          : ev.type}
                                      </span>
                                    </td>
                                    <td className={`py-2 pr-3 text-right font-mono font-bold ${isDeposit ? 'text-amber-400/70' : isRevenue ? 'text-green-400' : 'text-white/50'}`}>
                                      ${Number(ev.amount).toFixed(4)}
                                    </td>
                                    <td className="py-2 pr-3 text-white/30 font-mono text-[10px]">
                                      {ev.source}
                                    </td>
                                    <td className="py-2 pr-3 text-center">
                                      {ev.settlement ? (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${settleColor}`}>
                                          {settlStatus}
                                        </span>
                                      ) : isRevenue ? (
                                        <span className="text-[10px] text-red-400/60">no settlement</span>
                                      ) : (
                                        <span className="text-[10px] text-white/15">—</span>
                                      )}
                                    </td>
                                    <td className="py-2">
                                      <div className="flex gap-1.5 flex-wrap">
                                        {ev.settlement?.moveToRevenueTxSignature && (
                                          <a href={`https://solscan.io/tx/${ev.settlement.moveToRevenueTxSignature}`} target="_blank" rel="noopener noreferrer"
                                            className="text-[10px] text-blue-400/70 hover:text-blue-400 font-mono">rev↗</a>
                                        )}
                                        {ev.settlement?.treasuryTxSignature && (
                                          <a href={`https://solscan.io/tx/${ev.settlement.treasuryTxSignature}`} target="_blank" rel="noopener noreferrer"
                                            className="text-[10px] text-blue-400/70 hover:text-blue-400 font-mono">tr↗</a>
                                        )}
                                        {ev.settlement?.distributionTxSignature && (
                                          <a href={`https://solscan.io/tx/${ev.settlement.distributionTxSignature}`} target="_blank" rel="noopener noreferrer"
                                            className="text-[10px] text-blue-400/70 hover:text-blue-400 font-mono">di↗</a>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {view === 'settlements' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-white/40">
                  One settlement record per revenue event. Retry sends only missing legs.
                </p>
                <div className="flex items-center gap-2">
                  {retryAllResult && (
                    <span className="text-xs text-white/50">
                      Retried {retryAllResult.retried}: {retryAllResult.succeeded} ok, {retryAllResult.failed} failed
                    </span>
                  )}
                  <button
                    disabled={retryAllRunning}
                    onClick={async () => {
                      setRetryAllRunning(true)
                      setRetryAllResult(null)
                      try {
                        const res = await fetch('/api/admin', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'retry_all_retryable' }),
                        })
                        const d = await res.json()
                        setRetryAllResult({ retried: d.retried ?? 0, succeeded: d.succeeded ?? 0, failed: d.failed ?? 0 })
                        load()
                      } finally {
                        setRetryAllRunning(false)
                      }
                    }}
                    className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    {retryAllRunning ? 'Retrying…' : 'Retry All Retryable'}
                  </button>
                  <button onClick={load} className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 px-3 py-1.5 rounded transition-colors">
                    Refresh
                  </button>
                </div>
              </div>

              {/* Settlement totals summary */}
              {settlementTotals && (
                <div className="border border-white/10 rounded-xl p-4 bg-white/2">
                  <div className="text-[10px] text-white/30 uppercase tracking-widest mb-3">All-Time Settlement Totals</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: 'Revenue Events', value: String(settlementTotals.totalEvents), color: 'text-white/70' },
                      { label: 'Total Amount', value: `$${settlementTotals.totalAmount.toFixed(2)}`, color: 'text-white' },
                      { label: 'Treasury Due', value: `$${settlementTotals.treasuryDue.toFixed(2)}`, color: 'text-white/60' },
                      { label: 'Distribution Due', value: `$${settlementTotals.distributionDue.toFixed(2)}`, color: 'text-blue-400/70' },
                      { label: 'Treasury Settled', value: `$${settlementTotals.treasurySettled.toFixed(2)}`, color: settlementTotals.treasurySettled >= settlementTotals.treasuryDue ? 'text-green-400' : 'text-white/50' },
                      { label: 'Distribution Settled', value: `$${settlementTotals.distributionSettled.toFixed(2)}`, color: settlementTotals.distributionSettled >= settlementTotals.distributionDue ? 'text-green-400' : 'text-blue-400/50' },
                      { label: 'Pending Amount', value: `$${settlementTotals.pendingAmount.toFixed(2)}`, color: settlementTotals.pendingAmount > 0 ? 'text-amber-400' : 'text-white/30' },
                      { label: 'Failed Amount', value: `$${settlementTotals.failedAmount.toFixed(2)}`, color: settlementTotals.failedAmount > 0 ? 'text-red-400' : 'text-white/30' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/3 rounded-lg p-2">
                        <div className={`font-mono font-bold text-sm ${color}`}>{value}</div>
                        <div className="text-white/30 text-[10px] mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settlements.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-12">No settlement records yet. They are created when ads are billed or activated.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/30 uppercase tracking-widest border-b border-white/10">
                        <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Date</th>
                        <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Type</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Amount</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Treas.</th>
                        <th className="pb-2 text-right font-medium pr-3 whitespace-nowrap">Dist.</th>
                        <th className="pb-2 text-center font-medium pr-3 whitespace-nowrap">Status</th>
                        <th className="pb-2 text-left font-medium pr-3 whitespace-nowrap">Leg Status</th>
                        <th className="pb-2 text-left font-medium whitespace-nowrap">Error / Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.map((s) => {
                        const statusColor =
                          s.settlementStatus === 'SETTLED' ? 'text-green-400 bg-green-400/10'
                          : s.settlementStatus === 'FAILED' ? 'text-red-400 bg-red-400/10'
                          : s.settlementStatus === 'PARTIAL' ? 'text-amber-400 bg-amber-400/10'
                          : s.settlementStatus === 'UNSETTLED' ? 'text-white/40 bg-white/5'
                          : 'text-blue-400 bg-blue-400/10'
                        const canRetry = ['FAILED', 'PARTIAL', 'UNSETTLED'].includes(s.settlementStatus)

                        // Derive per-leg status from tx signatures + overall status
                        const leg1Done = !!s.moveToRevenueTxSignature
                        const leg2Done = !!s.treasuryTxSignature
                        const leg3Done = !!s.distributionTxSignature
                        const isTerminalFail = s.settlementStatus === 'FAILED' || s.settlementStatus === 'PARTIAL'

                        const leg1Status: 'confirmed' | 'pending' | 'failed' =
                          leg1Done ? 'confirmed'
                          : isTerminalFail ? 'failed'
                          : 'pending'
                        const leg2Status: 'confirmed' | 'pending' | 'failed' | 'waiting' =
                          leg2Done ? 'confirmed'
                          : !leg1Done ? 'waiting'
                          : isTerminalFail ? 'failed'
                          : 'pending'
                        const leg3Status: 'confirmed' | 'pending' | 'failed' | 'waiting' =
                          leg3Done ? 'confirmed'
                          : !leg1Done ? 'waiting'
                          : isTerminalFail ? 'failed'
                          : 'pending'

                        const LegBadge = ({ status, label, sig }: { status: string; label: string; sig: string | null }) => {
                          if (sig) return (
                            <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener noreferrer"
                              className="text-[9px] px-1 py-0.5 rounded bg-green-500/20 text-green-400 font-mono whitespace-nowrap hover:bg-green-500/30">
                              {label} ✓↗
                            </a>
                          )
                          if (status === 'waiting') return (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-white/20 whitespace-nowrap">{label} –</span>
                          )
                          if (status === 'failed') return (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-400 whitespace-nowrap">{label} ✗</span>
                          )
                          return (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 whitespace-nowrap">{label} ⏳</span>
                          )
                        }

                        return (
                          <tr key={s.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                            <td className="py-2 pr-3 text-white/50 whitespace-nowrap">
                              {new Date(s.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                                s.revenueEvent.type === 'AD_RENT_REVENUE' ? 'text-green-400 bg-green-400/10' : 'text-blue-400 bg-blue-400/10'
                              }`}>
                                {s.revenueEvent.type === 'AD_RENT_REVENUE' ? 'AD_RENT' : 'TRADING_FEE'}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right font-mono font-bold text-white">
                              ${Number(s.amount).toFixed(4)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-white/50">
                              ${Number(s.treasuryAmount).toFixed(4)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-white/50">
                              ${Number(s.distributionAmount).toFixed(4)}
                            </td>
                            <td className="py-2 pr-3 text-center">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor}`}>
                                {s.settlementStatus}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              <div className="flex flex-col gap-0.5">
                                <LegBadge status={leg1Status} label="Src→Rev" sig={s.moveToRevenueTxSignature} />
                                <LegBadge status={leg2Status} label="Rev→Treas" sig={s.treasuryTxSignature} />
                                <LegBadge status={leg3Status} label="Rev→Dist" sig={s.distributionTxSignature} />
                              </div>
                            </td>
                            <td className="py-2">
                              <div className="flex flex-col gap-1 min-w-0">
                                {s.settlementError && (
                                  <div className="text-[10px] text-red-400/70 max-w-xs truncate" title={s.settlementError}>
                                    {s.settlementError}
                                  </div>
                                )}
                                <div className="flex items-center gap-1 flex-wrap">
                                  {s.retryable ? (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">auto-retry</span>
                                  ) : s.settlementStatus === 'FAILED' ? (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-400/60 border border-red-500/20">no-retry</span>
                                  ) : null}
                                  {s.retryCount > 0 && (
                                    <span className="text-[9px] text-white/20">{s.retryCount}× retried</span>
                                  )}
                                </div>
                                {s.retryable && s.nextRetryAt && (
                                  <div className="text-[9px] text-white/30">
                                    Next: {new Date(s.nextRetryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                )}
                                {canRetry && (
                                  <button
                                    disabled={!!retryingSettlement[s.id]}
                                    onClick={async () => {
                                      setRetryingSettlement((r) => ({ ...r, [s.id]: true }))
                                      try {
                                        const res = await fetch('/api/admin', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ action: 'retry_settlement', revenueEventId: s.revenueEventId }),
                                        })
                                        const d = await res.json()
                                        setActionMsg(d.ok ? `Settlement ${d.status}` : `Error: ${d.error}`)
                                        setTimeout(() => setActionMsg(''), 4000)
                                        load()
                                      } finally {
                                        setRetryingSettlement((r) => ({ ...r, [s.id]: false }))
                                      }
                                    }}
                                    className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-2 py-0.5 rounded transition-colors disabled:opacity-50 w-fit"
                                  >
                                    {retryingSettlement[s.id] ? 'Retrying…' : 'Retry Now'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
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

              {/* Action 4: Full Prelaunch Reset — nuclear */}
              <div className="border-2 border-red-600/50 rounded-xl p-5 space-y-4 bg-red-950/20">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-red-400 tracking-tight">Full Prelaunch Reset</h3>
                  <p className="text-red-300/60 text-xs leading-relaxed">
                    Deletes ALL test data — rentals, creatives, topups, billing runs, revenue events, settlements, epochs, claims, snapshots, processed transactions — and zeros every advertiser balance.
                    Settings, wallet config, excluded wallets, and env vars are untouched.
                    <span className="block mt-1 text-red-400/80 font-semibold">This cannot be undone.</span>
                  </p>
                  <div className="text-[10px] text-white/30 pt-1 space-y-0.5">
                    <div>Preserved: Settings table · ExcludedWallets · User records · Wallet env config · R2 config · Helius config</div>
                    <div>Cleared: Rentals · Creatives · Topups · Revenue events · Settlements · Billing runs · Epochs · Claims · Snapshots · Processed txs · Advertiser balances → $0</div>
                  </div>
                </div>

                {prelaunchResult ? (
                  <div className="border border-green-500/30 rounded-lg p-4 bg-green-950/20 space-y-3">
                    <div className="text-green-400 font-bold text-sm">Reset complete ✓</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      {[
                        { label: 'Rentals deleted', value: prelaunchResult.rentals },
                        { label: 'Creatives deleted', value: prelaunchResult.creatives },
                        { label: 'Topups deleted', value: prelaunchResult.topups },
                        { label: 'Revenue events deleted', value: prelaunchResult.revenueEvents },
                        { label: 'Settlements deleted', value: prelaunchResult.settlements },
                        { label: 'Billing items deleted', value: prelaunchResult.billingItems },
                        { label: 'Billing runs deleted', value: prelaunchResult.billingRuns },
                        { label: 'Epochs deleted', value: prelaunchResult.epochs },
                        { label: 'Claims deleted', value: prelaunchResult.claims },
                        { label: 'Snapshots deleted', value: prelaunchResult.holderSnapshots },
                        { label: 'Processed txs deleted', value: prelaunchResult.processedTxs },
                        { label: 'Balances zeroed', value: prelaunchResult.usersBalancesZeroed },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white/5 rounded px-2 py-1.5">
                          <div className="font-mono font-bold text-white">{value}</div>
                          <div className="text-white/40 text-[10px]">{label}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { setPrelaunchResult(null); setPrelaunchConfirm('') }}
                      className="text-xs text-white/30 hover:text-white transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs text-red-300/70">
                      Type <span className="font-mono font-bold text-red-300">RESET BILLIONBOARD</span> to enable:
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={prelaunchConfirm}
                        onChange={(e) => setPrelaunchConfirm(e.target.value)}
                        placeholder="RESET BILLIONBOARD"
                        className="flex-1 bg-black/30 border border-red-600/40 rounded-lg px-3 py-2 text-red-300 text-xs font-mono focus:outline-none focus:border-red-400 placeholder-red-900"
                      />
                      <button
                        disabled={prelaunchConfirm !== 'RESET BILLIONBOARD' || prelaunchRunning}
                        onClick={async () => {
                          setPrelaunchRunning(true)
                          try {
                            const res = await fetch('/api/admin', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'full_prelaunch_reset', confirm: prelaunchConfirm }),
                            })
                            const d = await res.json()
                            if (res.ok && d.ok) {
                              setPrelaunchResult(d.summary)
                              setPrelaunchConfirm('')
                              load()
                            } else {
                              setActionMsg(`Reset failed: ${d.error ?? 'Unknown error'}`)
                              setTimeout(() => setActionMsg(''), 6000)
                            }
                          } catch {
                            setActionMsg('Network error during reset')
                            setTimeout(() => setActionMsg(''), 6000)
                          } finally {
                            setPrelaunchRunning(false)
                          }
                        }}
                        className="text-xs bg-red-600/30 hover:bg-red-600/50 border border-red-600/60 text-red-300 px-4 py-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed font-semibold whitespace-nowrap"
                      >
                        {prelaunchRunning ? 'Resetting…' : 'Full Prelaunch Reset'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </>
      )}
    </div>
  )
}
