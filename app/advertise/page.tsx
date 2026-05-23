'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { Transaction, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token'
import Billboard from '@/components/Billboard'
import ImageUpload from '@/components/ImageUpload'
import Loupe from '@/components/Loupe'
import { BOARD_COLUMNS, BOARD_ROWS, tileIdToCoords, isRectangularSelection, runRectangularSelectionTests, canAffordCents, shortfallCents as balanceShortfallCents, runBalancePrecisionTests } from '@/lib/types'
import type { TileInfoMap, DisplayMode } from '@/lib/types'

type AuthState = 'idle' | 'logging_in' | 'logged_in'
type Step = 'select' | 'creative' | 'review' | 'submitted'
type PayStatus = 'idle' | 'creating' | 'waiting_wallet' | 'submitting' | 'confirming' | 'timeout'

const USDC_MINT_ADDRESS = process.env.NEXT_PUBLIC_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

interface PendingDeposit {
  topupId: string
  depositWallet: string
  advertiserWallet: string
  expiresAt: string
  txSignature?: string
  amount?: number
}

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8] as const
type ZoomLevel = (typeof ZOOM_LEVELS)[number]

export default function AdvertisePage() {
  const { publicKey, sendTransaction } = useWallet()
  const { connection } = useConnection()
  const { setVisible: openWalletModal } = useWalletModal()
  const [authState, setAuthState] = useState<AuthState>('idle')
  const [balance, setBalance] = useState<number | null>(null)
  const [tiles, setTiles] = useState<TileInfoMap>({})
  const [tilePrice, setTilePrice] = useState(1)
  const [freeRental, setFreeRental] = useState({ enabled: false, days: 0 })
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(true)
  const [submittedAutoApproved, setSubmittedAutoApproved] = useState(false)
  const [selectedTiles, setSelectedTiles] = useState<Set<number>>(new Set())
  const [step, setStep] = useState<Step>('select')
  const [topupAmount, setTopupAmount] = useState('10')
  const [topping, setTopping] = useState(false)
  const [showTopup, setShowTopup] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [walletInput, setWalletInput] = useState('')
  const [savingWallet, setSavingWallet] = useState(false)
  const [pendingDeposit, setPendingDeposit] = useState<PendingDeposit | null>(null)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({ imageUrl: '', destUrl: '', altText: '' })
  const [displayMode, setDisplayMode] = useState<DisplayMode>('REPEAT')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [urlError, setUrlError] = useState('')
  const [displayModeError, setDisplayModeError] = useState('')
  const [topupError, setTopupError] = useState('')
  const [payStatus, setPayStatus] = useState<PayStatus>('idle')
  const [topupSuccess, setTopupSuccess] = useState(false)

  // Zoom / pan state for the tile selector
  const [selectionMode, setSelectionMode] = useState<'click' | 'box'>('click')
  const [boxSelectError, setBoxSelectError] = useState('')

  const [zoomIdx, setZoomIdx] = useState(2)
  const zoom: ZoomLevel = ZOOM_LEVELS[zoomIdx]
  const boardContainerRef = useRef<HTMLDivElement>(null)
  const sentAtRef = useRef<number>(0)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const initialScrollDone = useRef(false)

  const zoomIn = useCallback(
    () => setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1)),
    []
  )
  const zoomOut = useCallback(() => setZoomIdx((i) => Math.max(i - 1, 0)), [])

  // Board display dimensions (computed before effects that depend on them)
  const aspect = BOARD_COLUMNS / BOARD_ROWS
  const fitW =
    containerSize.h > 0
      ? Math.min(containerSize.w, containerSize.h * aspect)
      : containerSize.w || 800
  const fitH = fitW / aspect
  const boardW = fitW * zoom
  const boardH = fitH * zoom

  // Observe container resize to compute fit dimensions
  useEffect(() => {
    const el = boardContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setContainerSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [step]) // re-attach when step changes (container mounts/unmounts)

  // Reset center-scroll flag when the select step re-mounts
  useEffect(() => {
    if (step === 'select') initialScrollDone.current = false
  }, [step])

  // Center the board on first measurement at each step visit
  useEffect(() => {
    if (initialScrollDone.current) return
    const el = boardContainerRef.current
    if (!el || containerSize.w === 0 || boardW === 0) return
    initialScrollDone.current = true
    el.scrollLeft = Math.max(0, (boardW - containerSize.w) / 2)
    el.scrollTop = Math.max(0, (boardH - containerSize.h) / 2)
  }, [containerSize.w, containerSize.h, boardW, boardH])

  // Wheel zoom (no-modifier scroll = zoom)
  useEffect(() => {
    const el = boardContainerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY < 0) zoomIn()
      else zoomOut()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [step, zoomIn, zoomOut])

  // Loupe state
  const [loupeEnabled, setLoupeEnabled] = useState(true)
  const [loupeCursor, setLoupeCursor] = useState<{
    tileId: number | null
    canvasX: number
    canvasY: number
    viewportX: number
    viewportY: number
    canvas: HTMLCanvasElement | null
  } | null>(null)

  const handleCursorMove = useCallback(
    (info: {
      tileId: number | null
      canvasX: number
      canvasY: number
      viewportX: number
      viewportY: number
      canvas: HTMLCanvasElement
    }) => {
      if (!loupeEnabled) return
      setLoupeCursor({ ...info })
    },
    [loupeEnabled]
  )

  const handleCursorLeave = useCallback(() => {
    setLoupeCursor(null)
  }, [])

  const loadTiles = useCallback(async () => {
    const res = await fetch('/api/tiles')
    const data = await res.json()
    setTiles(data.tiles ?? {})
  }, [])

  const loadBalance = useCallback(async () => {
    const res = await fetch('/api/topup')
    if (res.ok) {
      const data = await res.json()
      setBalance(Number(data.balance))
      setWalletAddress(data.walletAddress ?? '')
      setWalletInput(data.walletAddress ?? '')
      setAuthState('logged_in')
      // Resume in-flight payment from a prior session (only if signature was already stored)
      const pending = (data.topups as Array<{ status: string; id: string; depositWallet: string; advertiserWallet: string; expiresAt: string; txSignature?: string; amount?: number; method?: string }>)
        ?.find((t) => t.status === 'PENDING' && t.method === 'usdc_solana')
      if (pending?.txSignature) {
        setPendingDeposit({
          topupId: pending.id,
          depositWallet: pending.depositWallet,
          advertiserWallet: pending.advertiserWallet,
          expiresAt: pending.expiresAt,
          txSignature: pending.txSignature,
          amount: pending.amount ? Number(pending.amount) : undefined,
        })
        setPayStatus('confirming')
        setShowTopup(true)
      }
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        const price = parseFloat(data.settings.tile_price_usd_per_day ?? '1') || 1
        setTilePrice(price)
        setFreeRental({
          enabled: data.settings.free_rental_enabled === 'true',
          days: parseInt(data.settings.free_rental_days, 10) || 0,
        })
        setAutoApproveEnabled(data.settings.auto_approve_ads !== 'false')
      }
    } catch { /* fallback to $1 */ }
  }, [])

  useEffect(() => {
    loadTiles()
    loadBalance()
    loadSettings()
  }, [loadTiles, loadBalance, loadSettings])

  // Dev: verify selection and balance precision logic on mount; check browser console for results
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      runRectangularSelectionTests()
      runBalancePrecisionTests()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-authenticate when wallet connects and no session exists yet
  useEffect(() => {
    if (!publicKey || authState === 'logged_in') return
    const addr = publicKey.toBase58()
    setAuthState('logging_in')
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: addr }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.ok) loadBalance(); else setAuthState('idle') })
      .catch(() => setAuthState('idle'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey])

  // Auto-save connected wallet address to advertiser account
  useEffect(() => {
    if (!publicKey || authState !== 'logged_in') return
    const addr = publicKey.toBase58()
    if (addr === walletAddress) return
    fetch('/api/user/wallet', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: addr }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setWalletAddress(addr) })
      .catch(() => {})
  }, [publicKey, authState, walletAddress])

  const handleSaveWallet = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingWallet(true)
    setTopupError('')
    try {
      const res = await fetch('/api/user/wallet', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: walletInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTopupError(data.error ?? 'Failed to save wallet')
      } else {
        setWalletAddress(walletInput.trim())
        setTopupError('')
      }
    } catch {
      setTopupError('Network error')
    } finally {
      setSavingWallet(false)
    }
  }

  const handlePayUsdc = async () => {
    const amt = parseFloat(topupAmount)
    if (!amt || amt <= 0) {
      setTopupError('Enter a valid amount greater than 0')
      return
    }
    if (!publicKey || !sendTransaction) {
      setTopupError('Wallet not connected')
      return
    }

    setTopping(true)
    setTopupError('')
    setPayStatus('creating')

    try {
      // 1. Create pending topup with amount
      const res = await fetch('/api/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'usdc_solana', amount: amt }),
      })
      const data = await res.json() as { topupId?: string; depositWallet?: string; advertiserWallet?: string; expiresAt?: string; error?: string }
      if (!res.ok) {
        setTopupError(data.error ?? 'Failed to create deposit request')
        setPayStatus('idle')
        return
      }

      const { topupId, depositWallet: depWallet, advertiserWallet: advWallet, expiresAt } = data as Required<typeof data>
      setPendingDeposit({ topupId, depositWallet: depWallet, advertiserWallet: advWallet, expiresAt, amount: amt })

      // 2. Build SPL USDC transfer transaction
      setPayStatus('waiting_wallet')
      const usdcMint = new PublicKey(USDC_MINT_ADDRESS)
      const destPubkey = new PublicKey(depWallet)
      const fromATA = await getAssociatedTokenAddress(usdcMint, publicKey)
      const toATA = await getAssociatedTokenAddress(usdcMint, destPubkey)
      const rawUnits = BigInt(Math.round(amt * 1_000_000))

      const tx = new Transaction().add(createTransferInstruction(fromATA, toATA, publicKey, rawUnits))
      const { blockhash } = await connection.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      tx.feePayer = publicKey

      // 3. Send via wallet adapter — user approves in wallet popup
      setPayStatus('submitting')
      const signature = await sendTransaction(tx, connection)

      // 4. Store signature immediately, then kick off immediate Helius verify
      await fetch('/api/topup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topupId, txSignature: signature }),
      })

      setPendingDeposit((prev) => prev ? { ...prev, txSignature: signature } : null)
      sentAtRef.current = Date.now()
      setPayStatus('confirming')

      // Immediately check — backend attempts Helius confirmation right away
      fetch('/api/topup/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topupId }),
      }).catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const isCancel = /reject|cancel|user denied/i.test(msg)
      const isRpcForbidden = /403|access.?forbidden/i.test(msg)

      if (isRpcForbidden) {
        setTopupError(
          'Payment failed because the Solana RPC endpoint rejected the request. Please try again or contact support.'
        )
        if (process.env.NODE_ENV !== 'production') {
          try {
            const rawUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
            const host = new URL(rawUrl).hostname
            console.error('[pay-usdc] RPC 403', {
              host,
              network: process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'mainnet-beta',
              error: msg,
            })
          } catch { /* URL parse failed */ }
        }
      } else {
        setTopupError(isCancel ? 'Transaction cancelled' : (msg || 'Transaction failed'))
      }

      setPayStatus('idle')
      setPendingDeposit(null)
    } finally {
      setTopping(false)
    }
  }

  const handleMockTopup = async (e: React.FormEvent) => {
    e.preventDefault()
    setTopping(true)
    setTopupError('')
    try {
      const res = await fetch('/api/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'mock', amount: topupAmount }),
      })
      const text = await res.text()
      type TopupResult = { ok?: boolean; newBalance?: number; error?: string }
      let data: TopupResult | null = null
      try { data = text ? (JSON.parse(text) as TopupResult) : null } catch { /* ignore */ }
      if (!res.ok || !data?.ok) {
        setTopupError(data?.error ?? 'Top-up failed. Please try again.')
      } else {
        setBalance(Number(data.newBalance))
      }
    } catch {
      setTopupError('Network error. Check your connection and try again.')
    } finally {
      setTopping(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Poll for deposit confirmation (only while waiting for on-chain confirm)
  useEffect(() => {
    if (!pendingDeposit || (payStatus !== 'confirming' && payStatus !== 'timeout')) return
    const interval = setInterval(async () => {
      // 60s timeout — only applies when we know the send time from this session
      if (sentAtRef.current > 0 && payStatus === 'confirming' && Date.now() - sentAtRef.current > 60_000) {
        setPayStatus('timeout')
      }

      // Use /api/topup/check when a sig is stored — it triggers Helius verification each poll.
      // Fall back to plain GET if no sig yet.
      if (pendingDeposit.txSignature) {
        try {
          const res = await fetch('/api/topup/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topupId: pendingDeposit.topupId }),
          })
          if (!res.ok) return
          const data = await res.json() as { ok: boolean; status?: string; balance?: number }
          if (data.balance != null) setBalance(data.balance)
          if (data.status && data.status !== 'PENDING') {
            setPendingDeposit(null)
            setShowTopup(false)
            setPayStatus('idle')
            sentAtRef.current = 0
            setTopupSuccess(true)
            setTimeout(() => setTopupSuccess(false), 5000)
          }
        } catch { /* ignore, retry next tick */ }
        return
      }

      // No sig stored yet — plain poll to pick up balance/status changes
      const res = await fetch('/api/topup')
      if (!res.ok) return
      const data = await res.json()
      setBalance(Number(data.balance))
      const entry = (data.topups as Array<{ id: string; status: string }>)
        ?.find((t) => t.id === pendingDeposit.topupId)
      if (!entry || entry.status !== 'PENDING') {
        setPendingDeposit(null)
        setShowTopup(false)
        setPayStatus('idle')
        sentAtRef.current = 0
        setTopupSuccess(true)
        setTimeout(() => setTopupSuccess(false), 5000)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [pendingDeposit, payStatus])

  const handleTileClick = useCallback(
    (tileId: number) => {
      const status = tiles[tileId]?.status
      if (status === 'ACTIVE' || status === 'PENDING') return
      setSelectedTiles((prev) => {
        const next = new Set(prev)
        if (next.has(tileId)) next.delete(tileId)
        else next.add(tileId)
        return next
      })
    },
    [tiles]
  )

  const handleBoxSelect = useCallback(
    (tileIds: number[]) => {
      setBoxSelectError('')
      const blocked = tileIds.filter((id) => {
        const s = tiles[id]?.status
        return s === 'ACTIVE' || s === 'PENDING'
      })
      if (blocked.length > 0) {
        setBoxSelectError('This block contains unavailable tiles. Choose another area.')
        return
      }
      setSelectedTiles(new Set(tileIds))
    },
    [tiles]
  )

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    if (!publicKey) {
      setError('Connect your wallet to submit your ad.')
      setSubmitting(false)
      return
    }
    if (process.env.NODE_ENV === 'development') {
      console.log('[advertise] submitting imageUrl:', form.imageUrl)
    }
    // form.destUrl holds the domain portion; compose full URL before sending
    const fullDestUrl = `https://${form.destUrl.trim()}`
    const res = await fetch('/api/rentals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tileIds: Array.from(selectedTiles),
        imageUrl: form.imageUrl,
        destUrl: fullDestUrl,
        altText: form.altText,
        displayMode,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setSubmittedAutoApproved((data as { autoApproved?: boolean }).autoApproved ?? false)
      setStep('submitted')
      await loadTiles()
    } else {
      setError(data.error ?? 'Submission failed')
    }
    setSubmitting(false)
  }

  const cost = selectedTiles.size * tilePrice
  const canAfford = freeRental.enabled || (balance !== null && canAffordCents(balance, cost))

  const blockInfo = useMemo(() => {
    if (selectedTiles.size === 0) return null
    const ids = Array.from(selectedTiles)
    if (!isRectangularSelection(ids)) return null
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity
    for (const id of ids) {
      const { col, row } = tileIdToCoords(id)
      if (col < minCol) minCol = col
      if (col > maxCol) maxCol = col
      if (row < minRow) minRow = row
      if (row > maxRow) maxRow = row
    }
    return { cols: maxCol - minCol + 1, rows: maxRow - minRow + 1 }
  }, [selectedTiles])

  // ── Connect wallet screen ────────────────────────────────────────────────────
  if (authState !== 'logged_in') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-black text-white mb-2">Advertise on BillionBoard</h1>
          <p className="text-white/40 text-sm mb-8">Connect your Solana wallet to select tiles and launch your ad.</p>
          {publicKey ? (
            <div className="text-white/50 text-sm animate-pulse">Signing in…</div>
          ) : (
            <button
              onClick={() => openWalletModal(true)}
              className="bg-green-400 hover:bg-green-300 text-black font-bold px-8 py-3 rounded-xl text-sm transition-colors"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Submitted screen ────────────────────────────────────────────────────────
  if (step === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">✓</div>
          <h2 className="text-2xl font-black text-white mb-2">
            {submittedAutoApproved ? 'Your ad is live!' : 'Submitted for review'}
          </h2>
          <p className="text-white/50 text-sm mb-6">
            {submittedAutoApproved
              ? 'Your ad is live and will appear on the board shortly. Billing starts today.'
              : 'Your ad is pending admin approval. You\'ll see it go live on the board once approved.'}
          </p>
          <button
            onClick={() => {
              setStep('select')
              setSelectedTiles(new Set())
              setForm({ imageUrl: '', destUrl: '', altText: '' })
              setDisplayMode('REPEAT')
              setUploadError('')
              setUrlError('')
              setDisplayModeError('')
              setZoomIdx(0)
            }}
            className="text-green-400 hover:text-green-300 text-sm transition-colors"
          >
            Submit another ad →
          </button>
        </div>
      </div>
    )
  }

  // ── Main advertise layout ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Top bar: balance + topup ── */}
      <div className="flex-shrink-0 border-b border-white/10 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-xs text-white/40 uppercase tracking-widest">Balance</div>
            <div className="font-mono font-bold text-white text-sm">
              ${balance?.toFixed(2) ?? '…'} USDC
            </div>
            <button
              onClick={() => setShowTopup((v) => !v)}
              className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded transition-colors"
            >
              + Top up
            </button>
            {topupSuccess && <span className="text-green-400 text-xs font-medium">USDC added!</span>}
            {topupError && <span className="text-red-400 text-xs">{topupError}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-white/40">
            {freeRental.enabled && freeRental.days > 0 && (
              <span className="text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full text-[10px] font-medium">
                First {freeRental.days}d free
              </span>
            )}
            <span className="text-white font-bold">{selectedTiles.size}</span> tiles
            selected&nbsp;·&nbsp;
            <span className={canAfford ? 'text-green-400' : 'text-red-400'}>
              {freeRental.enabled ? '$0 (free)' : `$${cost % 1 === 0 ? cost : cost.toFixed(2)}/day`}
            </span>
          </div>
        </div>

        {/* ── Expanded top-up panel ── */}
        {showTopup && (
          <div className="max-w-7xl mx-auto mt-3 border border-white/10 rounded-xl p-4 bg-white/2 space-y-4">

            {/* Wallet — connected wallet is primary, manual paste is fallback */}
            {publicKey ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-green-400 font-mono font-bold">{publicKey.toBase58().slice(0,6)}…{publicKey.toBase58().slice(-4)}</span>
                <span className="text-white/30">wallet connected</span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-white/50 text-xs">Connect wallet to top up with USDC.</p>
                <button
                  onClick={() => openWalletModal(true)}
                  className="text-xs bg-green-400 hover:bg-green-300 text-black font-bold px-4 py-1.5 rounded transition-colors"
                >
                  Connect Wallet
                </button>
              </div>
            )}

            {/* Pay USDC — one-click flow */}
            {publicKey && payStatus === 'idle' && !pendingDeposit && (
              <div className="space-y-2">
                <p className="text-xs text-white/50">
                  Top up instantly with USDC from your connected wallet.
                </p>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 text-xs pointer-events-none">$</span>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      className="w-24 bg-white/5 border border-white/10 rounded-lg pl-5 pr-2 py-1.5 text-white text-xs focus:outline-none focus:border-green-400"
                    />
                  </div>
                  <span className="text-white/30 text-xs">USDC</span>
                  <button
                    onClick={handlePayUsdc}
                    disabled={topping}
                    className="text-xs bg-green-400/20 hover:bg-green-400/30 border border-green-400/30 text-green-400 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Pay ${topupAmount || '0'} USDC
                  </button>
                </div>
              </div>
            )}

            {/* In-flight status */}
            {(payStatus === 'creating' || payStatus === 'waiting_wallet' || payStatus === 'submitting') && (
              <p className="text-xs text-white/50 animate-pulse">
                {payStatus === 'creating' && 'Creating payment request…'}
                {payStatus === 'waiting_wallet' && 'Approve the transaction in your wallet…'}
                {payStatus === 'submitting' && 'Submitting transaction to Solana…'}
              </p>
            )}

            {/* Confirming */}
            {pendingDeposit && payStatus === 'confirming' && (
              <div className="bg-green-400/5 border border-green-400/20 rounded-lg p-3 space-y-2">
                <p className="text-xs text-green-400 font-medium">Payment sent. Waiting for confirmation…</p>
                {pendingDeposit.txSignature && (
                  <a
                    href={`https://solscan.io/tx/${pendingDeposit.txSignature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors font-mono"
                  >
                    {pendingDeposit.txSignature.slice(0, 8)}…{pendingDeposit.txSignature.slice(-8)} →
                  </a>
                )}
                <p className="text-white/30 text-[10px] animate-pulse">Checking every 5s…</p>
              </div>
            )}

            {/* Timeout */}
            {pendingDeposit && payStatus === 'timeout' && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded-lg p-3 space-y-2">
                <p className="text-xs text-amber-400 font-medium">Taking longer than expected.</p>
                <p className="text-white/40 text-[10px]">
                  Your transaction may still confirm on-chain. Keep this page open or check Solscan.
                </p>
                {pendingDeposit.txSignature && (
                  <a
                    href={`https://solscan.io/tx/${pendingDeposit.txSignature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors"
                  >
                    View on Solscan →
                  </a>
                )}
                <button
                  onClick={() => { setPendingDeposit(null); setPayStatus('idle'); sentAtRef.current = 0 }}
                  className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                >
                  Start over
                </button>
              </div>
            )}

            {/* Dev-only mock top-up — admin wallet only */}
            {process.env.NODE_ENV !== 'production' &&
             publicKey?.toBase58() === process.env.NEXT_PUBLIC_ADMIN_WALLET && (
              <form onSubmit={handleMockTopup} className="flex items-center gap-2 pt-2 border-t border-white/5">
                <span className="text-[10px] text-amber-400/60 uppercase tracking-widest">Dev only</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={topping}
                  className="text-xs bg-amber-400/10 hover:bg-amber-400/20 text-amber-400 px-3 py-1 rounded transition-colors disabled:opacity-50"
                >
                  {topping ? '…' : 'Mock top-up'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* ── Step indicator ── */}
      <div className="flex-shrink-0 border-b border-white/10 px-4 py-2">
        <div className="max-w-7xl mx-auto flex gap-4 text-xs">
          {(['select', 'creative', 'review'] as Step[]).map((s, i) => (
            <button
              key={s}
              onClick={() => {
                if (s === 'select' || (s === 'creative' && selectedTiles.size > 0)) setStep(s)
              }}
              className={`flex items-center gap-1.5 transition-colors ${
                step === s ? 'text-white' : 'text-white/30 hover:text-white/60'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  step === s ? 'bg-green-400 text-black' : 'bg-white/10'
                }`}
              >
                {i + 1}
              </span>
              {s === 'select' ? 'Select Tiles' : s === 'creative' ? 'Upload Creative' : 'Review'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Step: select tiles (full remaining height) ── */}
      {step === 'select' && (
        <div className="flex-1 relative min-h-0">
          {/* Scrollable zoom viewport */}
          <div
            ref={boardContainerRef}
            className="absolute inset-0 overflow-auto"
          >
            {/* Inner wrapper: min-w/h-full so flex centering works at zoom=1 (contain)
                and the scroll area is never smaller than the board at higher zooms */}
            <div
              className="flex items-center justify-center"
              style={{ minWidth: '100%', minHeight: '100%' }}
            >
              {boardW > 0 && (
                <div style={{ width: boardW, height: boardH, flexShrink: 0 }}>
                  <Billboard
                    tiles={tiles}
                    selectedTiles={selectedTiles}
                    onTileClick={handleTileClick}
                    pixelSize={4}
                    interactive
                    className="w-full h-full"
                    onCursorMove={handleCursorMove}
                    onCursorLeave={handleCursorLeave}
                    selectionMode={selectionMode}
                    onBoxSelect={handleBoxSelect}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Loupe — fixed-positioned, uses viewport coords, unaffected by scroll */}
          {loupeEnabled && loupeCursor && (
            <Loupe
              sourceCanvas={loupeCursor.canvas}
              canvasX={loupeCursor.canvasX}
              canvasY={loupeCursor.canvasY}
              tileId={loupeCursor.tileId}
              tiles={tiles}
              selectedTiles={selectedTiles}
              pixelSize={4}
              visible={true}
              viewportX={loupeCursor.viewportX}
              viewportY={loupeCursor.viewportY}
              containerRect={boardContainerRef.current?.getBoundingClientRect() ?? null}
              tilePrice={tilePrice}
            />
          )}

          {/* Floating bottom-left: selection mode + zoom controls + legend */}
          <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-2 items-start">
            {/* Selection mode toggle */}
            <div className="flex items-center bg-black/80 border border-white/10 rounded-lg overflow-hidden">
              <button
                onClick={() => { setSelectionMode('click'); setBoxSelectError('') }}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  selectionMode === 'click'
                    ? 'bg-blue-600/30 text-blue-300 font-semibold'
                    : 'text-white/40 hover:text-white/70'
                }`}
                title="Click individual tiles to select or deselect"
              >
                Click Select
              </button>
              <div className="w-px h-4 bg-white/10" />
              <button
                onClick={() => { setSelectionMode('box'); setBoxSelectError('') }}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  selectionMode === 'box'
                    ? 'bg-blue-600/30 text-blue-300 font-semibold'
                    : 'text-white/40 hover:text-white/70'
                }`}
                title="Drag to select a rectangular block of tiles"
              >
                Box Select
              </button>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 bg-black/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/40">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-[#141414] border border-white/20" />
                Available
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-amber-600" />
                Pending
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-green-700" />
                Active
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-blue-600 border border-blue-400" />
                Selected
              </span>
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-black/80 border border-white/10 rounded-lg px-2 py-1">
              <button
                onClick={zoomOut}
                disabled={zoomIdx === 0}
                className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
                title="Zoom out"
              >
                −
              </button>
              <span className="text-xs text-white/60 w-8 text-center tabular-nums">
                {zoom}×
              </span>
              <button
                onClick={zoomIn}
                disabled={zoomIdx === ZOOM_LEVELS.length - 1}
                className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
                title="Zoom in"
              >
                +
              </button>
              <span className="text-white/20 mx-0.5">|</span>
              <button
                onClick={() => setZoomIdx(0)}
                className="text-xs text-white/50 hover:text-white transition-colors px-1"
                title="Fit to screen"
              >
                Fit
              </button>
              <span className="text-white/20 text-xs ml-1 hidden sm:block">· scroll to zoom</span>
              <span className="text-white/20 mx-0.5">|</span>
              <button
                onClick={() => setLoupeEnabled((v) => !v)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  loupeEnabled
                    ? 'text-green-400 bg-green-400/10 hover:bg-green-400/20'
                    : 'text-white/40 hover:text-white/70'
                }`}
                title="Toggle magnifier"
              >
                🔍 {loupeEnabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Floating bottom-right: hints + action bar */}
          <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
            {/* Box select error */}
            {boxSelectError && (
              <div className="text-xs text-amber-400 bg-black/90 border border-amber-400/20 rounded-lg px-3 py-2 max-w-[280px] text-right">
                {boxSelectError}
              </div>
            )}

            {/* Hint when nothing selected */}
            {selectedTiles.size === 0 && !boxSelectError && (
              <div className="text-xs text-white/30 bg-black/80 border border-white/10 rounded-lg px-3 py-1.5 text-right">
                {selectionMode === 'click'
                  ? 'Click tiles to select · Tip: use Box Select for larger blocks'
                  : 'Click and drag to select a rectangular block'}
              </div>
            )}

            {/* Block info when selection exists */}
            {selectedTiles.size > 0 && blockInfo && (
              <div className="text-xs bg-black/80 border border-white/10 rounded-lg px-3 py-1.5 text-right">
                <span className="text-blue-300 font-mono">
                  {blockInfo.cols} × {blockInfo.rows} block = {selectedTiles.size} tiles
                </span>
                <span className="text-white/30 mx-1.5">·</span>
                <span className="text-green-400">
                  {freeRental.enabled
                    ? 'Free'
                    : `$${(selectedTiles.size * tilePrice) % 1 === 0 ? selectedTiles.size * tilePrice : (selectedTiles.size * tilePrice).toFixed(2)}/day`}
                </span>
              </div>
            )}

            {/* Tile count when selection is not a rectangle */}
            {selectedTiles.size > 0 && !blockInfo && (
              <div className="text-xs bg-black/80 border border-white/10 rounded-lg px-3 py-1.5 text-right">
                <span className="text-white/60 font-mono">{selectedTiles.size} tiles</span>
                <span className="text-white/30 mx-1.5">·</span>
                <span className="text-green-400">
                  {freeRental.enabled
                    ? 'Free'
                    : `$${cost % 1 === 0 ? cost : cost.toFixed(2)}/day`}
                </span>
              </div>
            )}

            {/* Clear selection */}
            {selectedTiles.size > 0 && (
              <button
                onClick={() => { setSelectedTiles(new Set()); setBoxSelectError('') }}
                className="text-xs text-white/40 hover:text-white/70 bg-black/80 border border-white/10 rounded-lg px-3 py-1.5 transition-colors"
              >
                Clear selection
              </button>
            )}

            <button
              onClick={() => setStep('creative')}
              disabled={selectedTiles.size === 0}
              className="bg-green-400 hover:bg-green-300 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-green-400/20"
            >
              Next: Upload Creative ({selectedTiles.size} tile{selectedTiles.size !== 1 ? 's' : ''}
              {freeRental.enabled ? ' — Free' : ` — $${cost % 1 === 0 ? cost : cost.toFixed(2)}/day`}) →
            </button>
          </div>
        </div>
      )}

      {/* ── Step: creative (scrollable form) ── */}
      {step === 'creative' && (
        <div className="flex-1 overflow-auto min-h-0">
          <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
            <h2 className="text-lg font-bold text-white">Your Ad Creative</h2>

            <div>
              <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
                Ad Image
              </label>
              <ImageUpload
                value={form.imageUrl}
                onChange={(url) => setForm((f) => ({ ...f, imageUrl: url }))}
                onError={setUploadError}
              />
              {uploadError && <p className="text-red-400 text-xs mt-1.5">{uploadError}</p>}
            </div>

            <div>
              <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
                Destination URL
              </label>
              <div className="flex items-stretch rounded-lg overflow-hidden border border-white/10 focus-within:border-green-400 transition-colors">
                <span className="px-3 py-3 bg-white/3 text-white/30 text-sm flex items-center border-r border-white/10 shrink-0 select-none font-mono">
                  https://
                </span>
                <input
                  type="text"
                  value={form.destUrl}
                  onChange={(e) => {
                    // Strip any protocol the user typed or pasted to prevent double-prefix
                    const val = e.target.value.replace(/^https?:\/\//i, '').replace(/^\/\//, '')
                    setUrlError('')
                    setForm((f) => ({ ...f, destUrl: val }))
                  }}
                  placeholder="www.yourproject.com"
                  className="flex-1 bg-white/5 px-3 py-3 text-white text-sm focus:outline-none placeholder-white/20"
                />
              </div>
              <p className="text-white/30 text-xs mt-1.5">Example: www.yourproject.com</p>
              {urlError && <p className="text-red-400 text-xs mt-1">{urlError}</p>}
            </div>

            <div>
              <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
                Alt Text <span className="text-white/30">(optional)</span>
              </label>
              <input
                type="text"
                value={form.altText}
                onChange={(e) => setForm((f) => ({ ...f, altText: e.target.value }))}
                placeholder="Brief description of your ad"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/20 text-sm focus:outline-none focus:border-green-400"
              />
            </div>

            {/* Display mode selector */}
            <div>
              <label className="block text-xs text-white/50 uppercase tracking-widest mb-2">
                Display Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setDisplayMode('REPEAT'); setDisplayModeError('') }}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    displayMode === 'REPEAT'
                      ? 'border-green-400 bg-green-400/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                  }`}
                >
                  <div className="text-sm font-bold text-white mb-0.5">Repeat on each tile</div>
                  <div className="text-xs text-white/40 leading-snug">Image fills every selected tile. Best for scattered tiles, logos, and icons.</div>
                </button>
                <button
                  type="button"
                  onClick={() => { setDisplayMode('STRETCH'); setDisplayModeError('') }}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    displayMode === 'STRETCH'
                      ? 'border-green-400 bg-green-400/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                  }`}
                >
                  <div className="text-sm font-bold text-white mb-0.5">Stretch across block</div>
                  <div className="text-xs text-white/40 leading-snug">One image spans your entire rectangular block. Best for banners and large ads.</div>
                </button>
              </div>
              {displayMode === 'STRETCH' && blockInfo && (
                <p className="text-xs text-green-400/70 mt-2">
                  {blockInfo.cols} × {blockInfo.rows} block — {selectedTiles.size} tiles
                </p>
              )}
              {displayMode === 'STRETCH' && !blockInfo && selectedTiles.size > 0 && (
                <p className="text-xs text-amber-400/70 mt-2">
                  Your selection is not a rectangle. Go back and use Box Select to drag a clean block, or switch to Repeat mode.
                </p>
              )}
              {displayMode === 'STRETCH' && selectedTiles.size === 0 && (
                <p className="text-xs text-blue-400/60 mt-2">
                  Tip: use Box Select on the previous step to drag a rectangle in one move.
                </p>
              )}
              {displayModeError && (
                <p className="text-xs text-red-400 mt-2">{displayModeError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setUrlError(''); setDisplayModeError(''); setStep('select') }}
                className="flex-1 border border-white/20 text-white/70 hover:text-white py-2.5 rounded-lg text-sm transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  const domain = form.destUrl.trim()
                  if (!domain) { setUrlError('Please enter a valid website URL.'); return }
                  try {
                    const parsed = new URL(`https://${domain}`)
                    if (!parsed.hostname.includes('.')) throw new Error()
                  } catch {
                    setUrlError('Please enter a valid website URL.')
                    return
                  }
                  if (displayMode === 'STRETCH' && !isRectangularSelection(Array.from(selectedTiles))) {
                    setDisplayModeError('Stretch mode requires a rectangular block of connected tiles.')
                    return
                  }
                  setUrlError('')
                  setDisplayModeError('')
                  setStep('review')
                }}
                disabled={!form.imageUrl.startsWith('https://') || !form.destUrl.trim()}
                className="flex-1 bg-green-400 hover:bg-green-300 disabled:opacity-40 text-black font-bold py-2.5 rounded-lg text-sm transition-colors"
              >
                Review →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: review ── */}
      {step === 'review' && (
        <div className="flex-1 overflow-auto min-h-0">
          <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
            <h2 className="text-lg font-bold text-white">Review your order</h2>

            <div className="border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Tiles selected</span>
                <span className="text-white font-mono">{selectedTiles.size}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Daily rate</span>
                <span className="text-white font-mono">
                  {freeRental.enabled
                    ? `$0 (${freeRental.days}d free)`
                    : `$${cost % 1 === 0 ? cost : cost.toFixed(2)} USDC/day`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Your balance</span>
                <span className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-400'}`}>
                  ${balance?.toFixed(2) ?? '…'} USDC
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Display mode</span>
                <span className="text-white font-mono">{displayMode === 'STRETCH' ? `Stretch (${blockInfo?.cols}×${blockInfo?.rows})` : 'Repeat'}</span>
              </div>
              <div className="border-t border-white/10 pt-3">
                <div className="text-xs text-white/40">Destination</div>
                <div className="text-sm text-white/70 truncate">https://{form.destUrl}</div>
              </div>
              <div>
                <div className="text-xs text-white/40">Image</div>
                <div className="text-sm text-white/70 truncate">{form.imageUrl}</div>
              </div>
            </div>

            {!canAfford && !freeRental.enabled && (
              <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                Insufficient balance. Top up at least ${(balanceShortfallCents(balance ?? 0, cost) / 100).toFixed(2)} USDC.
              </div>
            )}

            {!publicKey && (
              <div className="bg-amber-900/30 border border-amber-500/30 rounded-lg p-3 text-amber-400 text-sm flex items-center justify-between">
                <span>Connect your wallet to submit your ad.</span>
                <button
                  onClick={() => openWalletModal(true)}
                  className="text-xs bg-amber-400/20 hover:bg-amber-400/30 text-amber-400 px-3 py-1.5 rounded transition-colors ml-3 flex-shrink-0"
                >
                  Connect
                </button>
              </div>
            )}

            {error && (
              <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="text-xs text-white/30 bg-white/5 rounded-lg p-3">
              {autoApproveEnabled
                ? 'Your ad goes live immediately. Balance is deducted daily — if it runs out, your tiles are released.'
                : 'Your ad will be reviewed before going live. Billing starts on approval. Balance is deducted daily — if it runs out, your tiles are released.'}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('creative')}
                className="flex-1 border border-white/20 text-white/70 hover:text-white py-2.5 rounded-lg text-sm transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !canAfford || !publicKey}
                className="flex-1 bg-green-400 hover:bg-green-300 disabled:opacity-40 text-black font-bold py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitting ? 'Submitting…' : autoApproveEnabled ? 'Go Live →' : 'Submit for approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
