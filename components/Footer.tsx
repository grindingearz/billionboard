import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-white/10 mt-16 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/40 mb-4">
          <Link href="/terms" className="hover:text-white/70 transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-white/70 transition-colors">Privacy</Link>
          <Link href="/advertising-policy" className="hover:text-white/70 transition-colors">Advertising Policy</Link>
          <Link href="/disclaimer" className="hover:text-white/70 transition-colors">Disclaimer</Link>
          <Link href="/leaderboard" className="hover:text-white/70 transition-colors">Leaderboard</Link>
          <Link href="/stats" className="hover:text-white/70 transition-colors">Stats</Link>
          <Link href="/claim" className="hover:text-white/70 transition-colors">Claim</Link>
          <Link href="/advertise" className="hover:text-white/70 transition-colors">Advertise</Link>
        </div>
        <div className="text-xs text-white/20">© 2025 BillionBoard. All rights reserved.</div>
      </div>
    </footer>
  )
}
