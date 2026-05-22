'use client'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useState, useRef, useEffect } from 'react'

function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export default function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet()
  const { setVisible } = useWalletModal()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  if (!publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        disabled={connecting}
        className="ml-2 bg-green-400 hover:bg-green-300 disabled:opacity-50 text-black text-xs font-bold px-3 py-1.5 rounded transition-colors"
      >
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
    )
  }

  return (
    <div ref={ref} className="relative ml-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-green-400/10 hover:bg-green-400/20 border border-green-400/30 text-green-400 text-xs font-bold px-3 py-1.5 rounded transition-colors font-mono"
      >
        {shorten(publicKey.toBase58())}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-black border border-white/10 rounded-lg shadow-xl z-50 min-w-[140px]">
          <div className="px-3 py-2 text-[10px] text-white/30 font-mono border-b border-white/5 truncate">
            {publicKey.toBase58()}
          </div>
          <button
            onClick={() => { disconnect(); setOpen(false) }}
            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-white/5 transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
