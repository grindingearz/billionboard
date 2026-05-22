'use client'

import { useState, useEffect, useCallback } from 'react'
import Billboard from '@/components/Billboard'
import type { TileStatusMap } from '@/lib/types'

type AuthState = 'idle' | 'logging_in' | 'logged_in'
type Step = 'select' | 'creative' | 'review' | 'submitted'

export default function AdvertisePage() {
  const [authState, setAuthState] = useState<AuthState>('idle')
  const [email, setEmail] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [tiles, setTiles] = useState<TileStatusMap>({})
  const [selectedTiles, setSelectedTiles] = useState<Set<number>>(new Set())
  const [step, setStep] = useState<Step>('select')
  const [topupAmount, setTopupAmount] = useState('10')
  const [topping, setTopping] = useState(false)
  const [form, setForm] = useState({ imageUrl: '', destUrl: '', altText: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [topupError, setTopupError] = useState('')

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
      setAuthState('logged_in')
    }
  }, [])

  useEffect(() => {
    loadTiles()
    loadBalance()
  }, [loadTiles, loadBalance])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthState('logging_in')
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (res.ok) {
      await loadBalance()
    } else {
      setAuthState('idle')
    }
  }

  const handleTopup = async (e: React.FormEvent) => {
    e.preventDefault()
    setTopping(true)
    setTopupError('')
    const res = await fetch('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: topupAmount }),
    })
    const data = await res.json()
    if (res.ok) {
      setBalance(Number(data.newBalance))
    } else {
      setTopupError(data.error ?? 'Top-up failed')
    }
    setTopping(false)
  }

  const handleTileClick = useCallback(
    (tileId: number) => {
      const status = tiles[tileId]
      if (status === 'ACTIVE' || status === 'PENDING') return
      setSelectedTiles((prev) => {
        const next = new Set(prev)
        if (next.has(tileId)) {
          next.delete(tileId)
        } else {
          next.add(tileId)
        }
        return next
      })
    },
    [tiles]
  )

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/rentals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tileIds: Array.from(selectedTiles),
        imageUrl: form.imageUrl,
        destUrl: form.destUrl,
        altText: form.altText,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setStep('submitted')
      await loadTiles()
    } else {
      setError(data.error ?? 'Submission failed')
    }
    setSubmitting(false)
  }

  const cost = selectedTiles.size * 1
  const canAfford = balance !== null && balance >= cost

  if (authState !== 'logged_in') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-black text-white mb-1">Advertise on BillionBoard</h1>
          <p className="text-white/40 text-sm mb-6">
            Sign in to select tiles and launch your ad
          </p>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-green-400 text-sm"
            />
            <button
              type="submit"
              disabled={authState === 'logging_in'}
              className="w-full bg-green-400 hover:bg-green-300 disabled:opacity-50 text-black font-bold py-3 rounded-lg text-sm transition-colors"
            >
              {authState === 'logging_in' ? 'Signing in…' : 'Continue with email'}
            </button>
          </form>
          {/* TODO: replace with Privy wallet connect */}
          <p className="text-center text-white/20 text-xs mt-4">
            Wallet connect coming after $BOARD launch
          </p>
        </div>
      </div>
    )
  }

  if (step === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">✓</div>
          <h2 className="text-2xl font-black text-white mb-2">Submitted for review</h2>
          <p className="text-white/50 text-sm mb-6">
            Your ad is pending admin approval. You&apos;ll see it go live on the board once approved.
          </p>
          <button
            onClick={() => {
              setStep('select')
              setSelectedTiles(new Set())
              setForm({ imageUrl: '', destUrl: '', altText: '' })
            }}
            className="text-green-400 hover:text-green-300 text-sm transition-colors"
          >
            Submit another ad →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="text-xs text-white/40 uppercase tracking-widest">Balance</div>
            <div className="font-mono font-bold text-white">
              ${balance?.toFixed(2) ?? '…'} USDC
            </div>
            {/* Mini top-up form */}
            <form onSubmit={handleTopup} className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="10000"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-green-400"
              />
              <button
                type="submit"
                disabled={topping}
                className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded transition-colors disabled:opacity-50"
              >
                {topping ? '…' : '+ Top up (mock)'}
              </button>
            </form>
            {/* TODO: replace mock top-up with real USDC detection */}
            {topupError && <span className="text-red-400 text-xs">{topupError}</span>}
          </div>

          <div className="flex items-center gap-2 text-xs text-white/40">
            <span className="text-white font-bold">{selectedTiles.size}</span> tiles selected
            &nbsp;·&nbsp;
            <span className={canAfford ? 'text-green-400' : 'text-red-400'}>
              ${cost}/day
            </span>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="border-b border-white/10 px-4 py-2">
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

      {/* Content */}
      {step === 'select' && (
        <div className="max-w-7xl mx-auto px-4 py-6">
          <p className="text-white/40 text-xs mb-4">
            Click tiles to select them. Green = active, amber = pending approval, dark = available.
          </p>
          <div className="rounded-xl overflow-hidden border border-white/10 mb-6 overflow-x-auto">
            <Billboard
              tiles={tiles}
              selectedTiles={selectedTiles}
              onTileClick={handleTileClick}
              pixelSize={8}
              interactive={true}
              className="min-w-full"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setStep('creative')}
              disabled={selectedTiles.size === 0}
              className="bg-green-400 hover:bg-green-300 disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              Next: Upload Creative ({selectedTiles.size} tiles) →
            </button>
          </div>
        </div>
      )}

      {step === 'creative' && (
        <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
          <h2 className="text-lg font-bold text-white">Your Ad Creative</h2>

          <div>
            <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
              Image URL
            </label>
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              placeholder="https://…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/20 text-sm focus:outline-none focus:border-green-400"
            />
            {/* TODO: replace with file upload to Vercel Blob or similar */}
            <p className="text-white/25 text-xs mt-1">
              Direct link to your ad image (PNG/JPG/GIF). File upload coming soon.
            </p>
          </div>

          <div>
            <label className="block text-xs text-white/50 uppercase tracking-widest mb-1.5">
              Destination URL
            </label>
            <input
              type="url"
              value={form.destUrl}
              onChange={(e) => setForm((f) => ({ ...f, destUrl: e.target.value }))}
              placeholder="https://…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/20 text-sm focus:outline-none focus:border-green-400"
            />
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

          <div className="flex gap-3">
            <button
              onClick={() => setStep('select')}
              className="flex-1 border border-white/20 text-white/70 hover:text-white py-2.5 rounded-lg text-sm transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('review')}
              disabled={!form.imageUrl || !form.destUrl}
              className="flex-1 bg-green-400 hover:bg-green-300 disabled:opacity-40 text-black font-bold py-2.5 rounded-lg text-sm transition-colors"
            >
              Review →
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
          <h2 className="text-lg font-bold text-white">Review your order</h2>

          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Tiles selected</span>
              <span className="text-white font-mono">{selectedTiles.size}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Daily rate</span>
              <span className="text-white font-mono">${cost.toFixed(2)} USDC/day</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Your balance</span>
              <span className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-400'}`}>
                ${balance?.toFixed(2) ?? '…'} USDC
              </span>
            </div>
            <div className="border-t border-white/10 pt-3">
              <div className="text-xs text-white/40">Destination</div>
              <div className="text-sm text-white/70 truncate">{form.destUrl}</div>
            </div>
            <div>
              <div className="text-xs text-white/40">Image</div>
              <div className="text-sm text-white/70 truncate">{form.imageUrl}</div>
            </div>
          </div>

          {!canAfford && (
            <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              Insufficient balance. Top up at least ${(cost - (balance ?? 0)).toFixed(2)} USDC.
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="text-xs text-white/30 bg-white/5 rounded-lg p-3">
            Your ad will be reviewed before going live. Billing starts on approval. Balance is
            deducted daily — if it runs out, your tiles are released.
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
              disabled={submitting || !canAfford}
              className="flex-1 bg-green-400 hover:bg-green-300 disabled:opacity-40 text-black font-bold py-2.5 rounded-lg text-sm transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
