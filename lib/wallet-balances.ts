import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token'
import { env } from './env'

const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDC_DECIMALS = 6

export interface WalletBalance {
  address: string | null
  balance: number | null
  error?: string
}

export interface WalletBalances {
  topupWallet: WalletBalance
  revenueWallet: WalletBalance
  treasuryWallet: WalletBalance
  distributionWallet: WalletBalance
  feeCreatorWallet: WalletBalance
}

async function fetchSingleBalance(connection: Connection, usdcMint: PublicKey, address: string): Promise<number> {
  const ata = await getAssociatedTokenAddress(usdcMint, new PublicKey(address))
  const account = await getAccount(connection, ata)
  return Number(account.amount) / Math.pow(10, USDC_DECIMALS)
}

export async function fetchWalletUsdcBalances(): Promise<WalletBalances> {
  const rpcUrl = env.heliusRpcUrl ?? 'https://api.mainnet-beta.solana.com'
  const usdcMintAddr = process.env.NEXT_PUBLIC_USDC_MINT?.trim() || USDC_MINT_MAINNET

  const walletMap: Record<keyof WalletBalances, string | null> = {
    topupWallet: env.topupWallet,
    revenueWallet: env.revenueWallet,
    treasuryWallet: env.treasuryWallet,
    distributionWallet: env.distributionWallet,
    feeCreatorWallet: env.feeCreatorWallet,
  }

  let connection: Connection
  let usdcMint: PublicKey
  try {
    connection = new Connection(rpcUrl, 'confirmed')
    usdcMint = new PublicKey(usdcMintAddr)
  } catch (err) {
    const error = err instanceof Error ? err.message.slice(0, 80) : 'RPC init failed'
    return Object.fromEntries(
      Object.entries(walletMap).map(([k, addr]) => [k, { address: addr, balance: null, error }])
    ) as unknown as WalletBalances
  }

  const results = await Promise.all(
    (Object.entries(walletMap) as [keyof WalletBalances, string | null][]).map(async ([key, address]) => {
      if (!address) return { key, result: { address: null, balance: null } as WalletBalance }
      try {
        const balance = await fetchSingleBalance(connection, usdcMint, address)
        return { key, result: { address, balance } as WalletBalance }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // No token account = 0 USDC balance (wallet exists but hasn't received USDC yet)
        if (
          msg.includes('could not find account') ||
          msg.includes('Account does not exist') ||
          msg.includes('TokenAccountNotFound') ||
          msg.includes('Invalid account owner')
        ) {
          return { key, result: { address, balance: 0 } as WalletBalance }
        }
        return { key, result: { address, balance: null, error: msg.slice(0, 100) } as WalletBalance }
      }
    })
  )

  return Object.fromEntries(results.map(({ key, result }) => [key, result])) as unknown as WalletBalances
}
