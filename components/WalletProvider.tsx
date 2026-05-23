'use client'

import { useMemo } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack'

const PUBLIC_FALLBACK = 'https://api.mainnet-beta.solana.com'

const ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? PUBLIC_FALLBACK

// Warn at startup when no dedicated RPC is configured — public mainnet RPC is heavily
// rate-limited and will return 403 on wallet transactions in production.
if (process.env.NODE_ENV !== 'production' && !process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
  console.warn(
    '[WalletProvider] NEXT_PUBLIC_SOLANA_RPC_URL is not set — falling back to public Solana RPC.' +
    ' Wallet transactions (Pay USDC) will likely fail with 403 in production.' +
    ' Add NEXT_PUBLIC_SOLANA_RPC_URL to .env.local (see ENV_SETUP.md).'
  )
}

export default function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new BackpackWalletAdapter(), new SolflareWalletAdapter()],
    []
  )

  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
