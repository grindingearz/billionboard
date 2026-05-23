import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { createSessionToken, sessionCookieOptions } from '@/lib/auth'
import { env } from '@/lib/env'

export async function POST(req: Request) {
  const body = await req.json()
  const { email, walletAddress, adminPassword } = body

  // Admin login — requires BOTH correct wallet AND correct password
  if (adminPassword !== undefined && adminPassword !== null) {
    const adminWallet = env.adminWallet  // already trimmed via env.ts
    if (!adminWallet) {
      return NextResponse.json({ error: 'ADMIN_WALLET is not configured.' }, { status: 503 })
    }

    const submittedWallet = (walletAddress ?? '').trim()
    if (!submittedWallet || submittedWallet !== adminWallet) {
      return NextResponse.json({ error: 'Connected wallet is not authorized.' }, { status: 403 })
    }

    const expectedPassword = env.adminPassword  // trimmed
    const submittedPassword = (adminPassword as string).trim()
    if (!expectedPassword || submittedPassword !== expectedPassword) {
      return NextResponse.json({ error: 'Invalid admin password.' }, { status: 401 })
    }

    let user = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    if (!user) {
      user = await prisma.user.create({
        data: { email: 'admin@billionboard.internal', role: 'ADMIN' },
      })
    }
    const token = await createSessionToken({ userId: user.id, role: 'ADMIN', adminWallet })
    const cookieStore = await cookies()
    cookieStore.set(sessionCookieOptions().name, token, sessionCookieOptions())
    return NextResponse.json({ ok: true, role: 'ADMIN' })
  }

  // Advertiser login — create or fetch user
  if (!email && !walletAddress) {
    return NextResponse.json({ error: 'email or walletAddress required' }, { status: 400 })
  }

  const where = email ? { email } : { walletAddress }
  let user = await prisma.user.findFirst({ where })

  if (!user) {
    user = await prisma.user.create({
      data: { email: email ?? null, walletAddress: walletAddress ?? null },
    })
  }

  // Ensure wallet exists
  await prisma.advertiserWallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  })

  const token = await createSessionToken({ userId: user.id, role: 'ADVERTISER', walletAddress: walletAddress ?? undefined })
  const cookieStore = await cookies()
  cookieStore.set(sessionCookieOptions().name, token, sessionCookieOptions())
  return NextResponse.json({ ok: true, role: 'ADVERTISER', userId: user.id })
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete('bb_session')
  return NextResponse.json({ ok: true })
}
