import type { Metadata } from 'next'
import '@solana/wallet-adapter-react-ui/styles.css'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import WalletProvider from '@/components/WalletProvider'

export const metadata: Metadata = {
  title: 'BillionBoard — The Internet Billboard Powered by $BOARD',
  description:
    'Rent tiles on the internet billboard powered by $BOARD on Solana. 100,000 tiles. Recognized ad revenue flows into the distribution pool for eligible $BOARD holders.',
  openGraph: {
    title: 'BillionBoard',
    description: '100,000 tiles. 1 billion $BOARD. One internet billboard.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-black text-white antialiased">
        <WalletProvider>
          <Navbar />
          <main style={{ paddingTop: 'var(--nav-height)' }}>{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  )
}
