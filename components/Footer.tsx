import Link from 'next/link'
import Image from 'next/image'

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-white/20">© 2025 BillionBoard. All rights reserved.</div>
          <a
            href="https://orynth.dev/projects/billionboard"
            target="_blank"
            rel="noopener"
            className="inline-flex w-fit rounded transition-opacity hover:opacity-85"
          >
            <Image
              src="https://orynth.dev/api/badge/billionboard?theme=dark&style=default"
              alt="Featured on Orynth"
              width="260"
              height="80"
              className="h-14 w-auto sm:h-16"
            />
          </a>
        </div>
      </div>
    </footer>
  )
}
