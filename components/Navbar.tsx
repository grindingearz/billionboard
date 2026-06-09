'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import WalletButton from './WalletButton'

const links = [
  { href: '/', label: 'Board' },
  { href: '/advertise', label: 'Advertise' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/claim', label: 'Claim' },
  { href: '/stats', label: 'Stats' },
]

export default function Navbar() {
  const path = usePathname()

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-black/85 backdrop-blur border-b border-white/10">
      <div
        className="max-w-7xl mx-auto px-3 sm:px-4 flex flex-col gap-1.5 py-2 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-0"
        style={{ minHeight: 'var(--nav-height)' }}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 group min-w-0 shrink-0">
            <div className="w-6 h-6 bg-green-400 rounded-sm group-hover:bg-green-300 transition-colors" />
            <span className="font-black text-white tracking-tight text-base sm:text-lg">
              BILLION<span className="text-green-400">BOARD</span>
            </span>
          </Link>
          <WalletButton />
        </div>

        <div className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-none -mx-1 px-1 sm:mx-0 sm:px-0">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`min-h-9 shrink-0 inline-flex items-center px-2 sm:px-3 py-1.5 rounded text-xs sm:text-sm font-medium transition-colors ${
                path === href
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
