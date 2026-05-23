import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { getSession } from '@/lib/auth'

/**
 * GET /api/admin/debug-auth?wallet=<address>
 *
 * Returns only safe, non-secret debug information:
 * - whether ADMIN_WALLET env is configured
 * - masked form of the admin wallet (first 4 + last 4 chars)
 * - whether the supplied wallet matches the admin wallet
 * - whether the current session is a valid admin session
 *
 * Never returns ADMIN_PASSWORD or the full ADMIN_WALLET.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const walletParam = (searchParams.get('wallet') ?? '').trim()

  const adminWallet = env.adminWallet  // trimmed via env.ts

  const hasAdminWalletEnv = !!adminWallet
  const maskedAdminWallet = adminWallet
    ? `${adminWallet.slice(0, 4)}…${adminWallet.slice(-4)}`
    : null

  const walletMatch = !!(adminWallet && walletParam && walletParam === adminWallet)

  const session = await getSession()
  const isAdminSession = !!(
    session?.role === 'ADMIN' &&
    session.adminWallet &&
    adminWallet &&
    session.adminWallet === adminWallet
  )

  return NextResponse.json({
    hasAdminWalletEnv,
    maskedAdminWallet,
    walletMatch,
    isAdminSession,
  })
}
