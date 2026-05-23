import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

const secret = () => new TextEncoder().encode(env.sessionSecret)

export interface SessionPayload {
  userId: string
  role: 'ADVERTISER' | 'ADMIN'
  /** Set only for ADMIN sessions; tied to the verified ADMIN_WALLET address. */
  adminWallet?: string
  /** Set for ADVERTISER sessions; matches the Solana wallet address used to log in. */
  walletAddress?: string
}

/** Returns true if the request's X-Wallet-Address header disagrees with the session wallet. */
export function walletMismatch(session: SessionPayload, req: Request): boolean {
  const reqWallet = req.headers.get('x-wallet-address')
  return !!(session.walletAddress && reqWallet && session.walletAddress !== reqWallet)
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('bb_session')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret())
}

export function sessionCookieOptions() {
  return {
    name: 'bb_session',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  }
}
