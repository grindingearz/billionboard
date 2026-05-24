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
    <nav className="fixed top-0 left-0 right-0 z-40 bg-black/80 backdrop-blur border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-6 h-6 bg-green-400 rounded-sm group-hover:bg-green-300 transition-colors" />
          <span className="font-black text-white tracking-tight text-lg">
            BILLION<span className="text-green-400">BOARD</span>
          </span>
        </Link>

        <div className="flex items-center gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                path === href
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
            </Link>
          ))}
          <WalletButton />
        </div>
      </div>
    </nav>
  )
}
