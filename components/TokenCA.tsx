'use client'

import { useState } from 'react'

interface Props {
  mint: string
  pumpfunUrl: string
  officialXUrl: string
}

function truncate(addr: string) {
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`
}

export default function TokenCA({ mint, pumpfunUrl, officialXUrl }: Props) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(mint).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!mint) {
    return (
      <div className="border border-white/10 rounded-xl p-5 bg-white/2">
        <h2 className="text-lg font-bold text-white mb-1">$BOARD Token</h2>
        <p className="text-xs text-white/40 mb-4">Token launch pending.</p>
        <div className="bg-amber-400/5 border border-amber-400/10 rounded-lg px-4 py-3 text-xs text-amber-400/80">
          The $BOARD contract address will be published here at launch. Follow{' '}
          {officialXUrl ? (
            <a href={officialXUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              our official X account
            </a>
          ) : (
            'our official X account'
          )}{' '}
          for the announcement. Do not trust contract addresses from unofficial sources.
        </div>
      </div>
    )
  }

  return (
    <div className="border border-green-400/20 rounded-xl p-5 bg-green-400/3">
      <h2 className="text-lg font-bold text-white mb-1">$BOARD Token</h2>
      <p className="text-xs text-white/40 mb-4">Solana SPL token. Use the contract address below.</p>

      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 mb-4">
        <span className="font-mono text-sm text-green-400 flex-1 truncate">{truncate(mint)}</span>
        <span className="font-mono text-xs text-white/30 hidden sm:block flex-1 truncate">{mint}</span>
        <button
          onClick={copy}
          className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 hover:border-white/20 flex-shrink-0"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {pumpfunUrl && (
          <a
            href={pumpfunUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors"
          >
            <span>↗</span> Pump.fun
          </a>
        )}
        {officialXUrl && (
          <a
            href={officialXUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors"
          >
            <span>↗</span> X / Twitter
          </a>
        )}
      </div>
    </div>
  )
}
