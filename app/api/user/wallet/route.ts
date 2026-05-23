import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { walletAddress: true },
  })
  return NextResponse.json({ walletAddress: user?.walletAddress ?? null })
}

export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { walletAddress } = await req.json()
  if (typeof walletAddress !== 'string' || !SOLANA_ADDRESS_RE.test(walletAddress)) {
    return NextResponse.json({ error: 'Invalid Solana wallet address' }, { status: 400 })
  }

  // Prevent overwriting a wallet address that belongs to a different user's session.
  // This is a safety net: the frontend should never call PATCH for a different wallet,
  // but if session state is stale this stops cross-wallet account corruption.
  const existing = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { walletAddress: true },
  })
  if (existing?.walletAddress && existing.walletAddress !== walletAddress) {
    return NextResponse.json({ error: 'Account already has a different wallet linked' }, { status: 409 })
  }

  try {
    await prisma.user.update({
      where: { id: session.userId },
      data: { walletAddress },
    })
  } catch {
    return NextResponse.json({ error: 'Address already linked to another account' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, walletAddress })
}
