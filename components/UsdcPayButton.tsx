'use client'

import { useState, useCallback, useEffect } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token'

const USDC_MINT_PK = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
)
const USDC_DECIMALS = 6

// Convert a user-supplied decimal string to USDC base units (bigint).
// Returns the bigint on success, or an error string on failure.
// Rejects > 6 decimal places to avoid silent truncation.
// Uses string arithmetic — no floating-point rounding.
function parseUsdc(amountStr: string): bigint | string {
  const s = amountStr.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return 'Invalid amount'
  const dot = s.indexOf('.')
  const intStr = dot === -1 ? s : s.slice(0, dot)
  const fracStr = dot === -1 ? '' : s.slice(dot + 1)
  if (fracStr.length > USDC_DECIMALS) return `Maximum ${USDC_DECIMALS} decimal places allowed`
  const fracPadded = fracStr.padEnd(USDC_DECIMALS, '0')
  const units = BigInt(intStr) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded)
  if (units <= BigInt(0)) return 'Amount must be greater than 0'
  return units
}

type PayState =
  | 'idle'
  | 'creating'   // creating pending topup record on server
  | 'sending'    // waiting for wallet approval
  | 'waiting'    // tx broadcast, polling backend for Helius confirmation
  | 'confirmed'
  | 'rejected'
  | 'error'

interface UsdcPayButtonProps {
  onConfirmed: (newBalance: number) => void
}

export default function UsdcPayButton({ onConfirmed }: UsdcPayButtonProps) {
  const { publicKey, sendTransaction } = useWallet()
  const { setVisible: openWalletModal } = useWalletModal()
  const { connection } = useConnection()

  const [amount, setAmount] = useState('10')
  const [state, setState] = useState<PayState>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [pendingTopupId, setPendingTopupId] = useState<string | null>(null)
  const [depositWallet, setDepositWallet] = useState<string | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [copied, setCopied] = useState(false)

  // Display wallet USDC balance (informational only — not used for precise tx checks)
  useEffect(() => {
    if (!publicKey) { setUsdcBalance(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const ata = await getAssociatedTokenAddress(USDC_MINT_PK, publicKey)
        const acct = await getAccount(connection, ata)
        if (!cancelled) setUsdcBalance(Number(acct.amount) / 10 ** USDC_DECIMALS)
      } catch {
        if (!cancelled) setUsdcBalance(0)
      }
    })()
    return () => { cancelled = true }
  }, [publicKey, connection])

  // Poll backend every 7s while waiting for Helius confirmation.
  // Balance is ONLY updated here — never from the frontend tx result.
  useEffect(() => {
    if (state !== 'waiting' || !pendingTopupId) return
    const id = setInterval(async () => {
      const res = await fetch('/api/topup')
      if (!res.ok) return
      const data = await res.json()
      const topup = (data.topups as Array<{ id: string; status: string }>)
        ?.find((t) => t.id === pendingTopupId)
      if (!topup || topup.status === 'PENDING') return
      clearInterval(id)
      if (topup.status === 'CONFIRMED') {
        setState('confirmed')
        onConfirmed(Number(data.balance)) // only credit point: backend-confirmed balance
      } else {
        setState('error')
        setErrMsg(`Top-up ${topup.status.toLowerCase()}`)
      }
    }, 7000)
    return () => clearInterval(id)
  }, [state, pendingTopupId, onConfirmed])

  const handlePay = useCallback(async () => {
    if (!publicKey) return

    // ── Amount validation (string-based, no float arithmetic) ──────────────
    const amountUnits = parseUsdc(amount)
    if (typeof amountUnits === 'string') { setErrMsg(amountUnits); return }

    setErrMsg('')
    setState('creating')

    // ── Step 1: create pending topup record, get deposit wallet ────────────
    let topupId: string
    let destWallet: string
    try {
      const res = await fetch('/api/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'usdc_solana' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create payment request')
      topupId = data.topupId
      destWallet = data.depositWallet
    } catch (e) {
      setState('error')
      setErrMsg(e instanceof Error ? e.message : 'Failed to create payment request')
      return
    }

    setPendingTopupId(topupId)
    setDepositWallet(destWallet)
    setState('sending')

    // ── Step 2: build and send SPL USDC transfer ───────────────────────────
    try {
      const destPubkey = new PublicKey(destWallet)
      const [sourceAta, destAta] = await Promise.all([
        getAssociatedTokenAddress(USDC_MINT_PK, publicKey),
        getAssociatedTokenAddress(USDC_MINT_PK, destPubkey),
      ])

      // Check source ATA at tx-build time (not stale state) for clear error messages
      let sourceAtaAccount
      try {
        sourceAtaAccount = await getAccount(connection, sourceAta)
      } catch (e) {
        if (e instanceof TokenAccountNotFoundError || e instanceof TokenInvalidAccountOwnerError) {
          setState('error')
          setErrMsg('No USDC token account found. You need USDC in your wallet.')
        } else {
          setState('error')
          setErrMsg('Failed to fetch USDC balance. Check your connection and try again.')
        }
        return
      }

      // Precise balance check against live on-chain amount (bigint comparison)
      if (amountUnits > sourceAtaAccount.amount) {
        setState('error')
        setErrMsg(
          `Insufficient USDC (wallet has $${(Number(sourceAtaAccount.amount) / 10 ** USDC_DECIMALS).toFixed(2)})`
        )
        return
      }

      const { blockhash } = await connection.getLatestBlockhash()
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: publicKey })

      // Create destination ATA if it doesn't yet exist (idempotent on-chain)
      const destAtaInfo = await connection.getAccountInfo(destAta)
      if (!destAtaInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(publicKey, destAta, destPubkey, USDC_MINT_PK)
        )
      }

      tx.add(
        createTransferCheckedInstruction(
          sourceAta,
          USDC_MINT_PK,
          destAta,
          publicKey,
          amountUnits, // bigint, exact — no Math.round
          USDC_DECIMALS
        )
      )

      const signature = await sendTransaction(tx, connection)

      // Step 3: store signature hint on pending topup (fire-and-forget)
      // 409 is fine — means another topup already has this sig (shouldn't happen)
      // 200 with ok:true means hint stored; Helius is still the confirmation source
      fetch('/api/topup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topupId, txSignature: signature }),
      }).catch(() => {})

      setState('waiting')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/reject|cancel|denied/i.test(msg)) {
        setState('rejected')
      } else {
        setState('error')
        setErrMsg(msg.slice(0, 120))
      }
    }
  }, [publicKey, sendTransaction, connection, amount])

  const reset = () => { setState('idle'); setErrMsg(''); setPendingTopupId(null) }

  if (!publicKey) {
    return (
      <div className="space-y-2">
        <p className="text-white/40 text-xs">Connect your wallet to pay with USDC.</p>
        <button
          onClick={() => openWalletModal(true)}
          className="text-xs bg-green-400 hover:bg-green-300 text-black font-bold px-4 py-1.5 rounded transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    )
  }

  if (state === 'confirmed') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          Payment confirmed — balance updated
        </div>
        <button onClick={reset} className="text-[10px] text-white/30 hover:text-white transition-colors">
          Make another payment
        </button>
      </div>
    )
  }

  if (state === 'waiting') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-amber-400 text-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Payment sent. Waiting for confirmation…
        </div>
        <p className="text-white/25 text-[10px]">
          Helius detects the on-chain transfer automatically — usually under 30s.
        </p>
        <button onClick={reset} className="text-[10px] text-white/25 hover:text-white transition-colors">
          Dismiss
        </button>
      </div>
    )
  }

  if (state === 'rejected') {
    return (
      <div className="space-y-2">
        <p className="text-white/50 text-xs">Transaction cancelled.</p>
        <button onClick={reset} className="text-xs text-green-400 hover:text-green-300 transition-colors">
          Try again
        </button>
      </div>
    )
  }

  const busy = state === 'creating' || state === 'sending'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-xs pointer-events-none">$</span>
          <input
            type="number"
            min="0.000001"
            max="10000"
            step="any"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setErrMsg('') }}
            disabled={busy}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-6 pr-3 py-2 text-white text-sm focus:outline-none focus:border-green-400 disabled:opacity-50"
          />
        </div>
        <button
          onClick={handlePay}
          disabled={busy || !amount}
          className="bg-green-400 hover:bg-green-300 disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
        >
          {state === 'creating' ? 'Preparing…'
            : state === 'sending' ? 'Approve in wallet…'
            : 'Pay USDC'}
        </button>
      </div>

      {usdcBalance !== null && (
        <p className="text-white/25 text-[10px]">Wallet balance: ${usdcBalance.toFixed(2)} USDC</p>
      )}

      {errMsg && <p className="text-red-400 text-xs">{errMsg}</p>}

      {/* Collapsible manual fallback */}
      <div>
        <button
          onClick={() => setShowManual((v) => !v)}
          className="text-[10px] text-white/20 hover:text-white/50 transition-colors"
        >
          {showManual ? '▲ Hide manual transfer' : '▼ Manual transfer'}
        </button>
        {showManual && (
          <div className="mt-2 bg-white/3 border border-white/8 rounded-lg p-3 space-y-2">
            <p className="text-white/40 text-[10px]">
              Send USDC directly from your connected wallet. Helius auto-detects the transfer
              and credits your balance.
            </p>
            {depositWallet ? (
              <div className="flex items-center gap-2">
                <code className="text-green-400 text-[10px] font-mono break-all flex-1">
                  {depositWallet}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(depositWallet)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded flex-shrink-0 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ) : (
              <p className="text-white/25 text-[10px]">
                Click &quot;Pay USDC&quot; first to generate the deposit address.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
