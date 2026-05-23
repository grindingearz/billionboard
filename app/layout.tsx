import type { Metadata } from 'next'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import WalletProvider from '@/components/WalletProvider'

export const metadata: Metadata = {
  title: 'BillionBoard — 1 Billion Pixel Internet Billboard',
  description:
    'Rent pixels on the worlds largest internet billboard. Powered by $BOARD on Solana.',
  openGraph: {
    title: 'BillionBoard',
    description: '1,000,000,000 pixels. 100,000 tiles. $1/tile/day.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-black text-white antialiased">
        <WalletProvider>
          <Navbar />
          <main className="pt-14">{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  )
}
