import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { amount } = await req.json()
  const parsed = parseFloat(amount)
  if (!parsed || parsed <= 0 || parsed > 10000) {
    return NextResponse.json({ error: 'Amount must be 1–10000' }, { status: 400 })
  }

  // TODO: replace with real USDC on-chain detection
  // For now: instantly confirm mock top-up
  await prisma.$transaction([
    prisma.topup.create({
      data: {
        userId: session.userId,
        amount: parsed,
        method: 'mock',
        status: 'CONFIRMED',
      },
    }),
    prisma.advertiserWallet.update({
      where: { userId: session.userId },
      data: { usdcBalance: { increment: parsed } },
    }),
  ])

  const wallet = await prisma.advertiserWallet.findUnique({
    where: { userId: session.userId },
    select: { usdcBalance: true },
  })

  return NextResponse.json({ ok: true, newBalance: wallet?.usdcBalance })
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [wallet, topups] = await Promise.all([
    prisma.advertiserWallet.findUnique({
      where: { userId: session.userId },
      select: { usdcBalance: true },
    }),
    prisma.topup.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  return NextResponse.json({ balance: wallet?.usdcBalance ?? 0, topups })
}
