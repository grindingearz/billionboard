import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { settleRevenueEvent } from '@/lib/settlement'
import { getOrCreateEpoch, utcDayStart } from '@/lib/epoch'

function authorized(req: Request): boolean {
  const secret = env.cronSecret
  if (!secret && process.env.NODE_ENV === 'production') return false
  return !secret || req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const periodStart = utcDayStart(now)
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000 - 1)

  // Find active campaigns due for recognition
  const campaigns = await prisma.adCreative.findMany({
    where: {
      campaignStatus: 'ACTIVE',
      nextRecognitionAt: { lte: now },
      campaignEndAt: { gt: now },
      durationType: { not: null },
    },
    select: {
      id: true,
      userId: true,
      durationType: true,
      durationDays: true,
      totalPrice: true,
      recognizedAmount: true,
      dailyRecognizedRevenue: true,
      campaignEndAt: true,
    },
  })

  if (campaigns.length === 0) {
    return NextResponse.json({ recognized: 0, results: [] })
  }

  const epoch = await getOrCreateEpoch(periodStart)

  const results: Array<{
    creativeId: string
    status: string
    ok: boolean
    amount?: number
    error?: string
  }> = []

  for (const campaign of campaigns) {
    try {
      // Check if already recognized for this period (idempotency)
      const existing = await prisma.campaignRevenueRecognition.findUnique({
        where: {
          creativeId_recognitionPeriodStart: {
            creativeId: campaign.id,
            recognitionPeriodStart: periodStart,
          },
        },
      })
      if (existing) {
        results.push({ creativeId: campaign.id, status: 'ALREADY_RECOGNIZED', ok: true, amount: 0 })
        continue
      }

      const totalPrice = Number(campaign.totalPrice ?? 0)
      const recognized = Number(campaign.recognizedAmount ?? 0)
      const daily = Number(campaign.dailyRecognizedRevenue ?? 0)

      // Never recognize more than totalPrice
      const remaining = totalPrice - recognized
      if (remaining <= 0) {
        await prisma.adCreative.update({
          where: { id: campaign.id },
          data: { campaignStatus: 'COMPLETED' },
        })
        results.push({ creativeId: campaign.id, status: 'COMPLETED', ok: true, amount: 0 })
        continue
      }

      const amountToRecognize = Math.min(daily, remaining)
      const isLastDay = remaining - amountToRecognize <= 0.001

      const nextRecognitionAt = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000)

      const { revenueEvent } = await prisma.$transaction(async (tx) => {
        const revenueEvent = await tx.revenueEvent.create({
          data: {
            type: 'AD_RENT_REVENUE',
            source: 'activation',
            amount: amountToRecognize,
            currency: 'USDC',
            epochId: epoch.id,
            userId: campaign.userId,
            metadata: {
              creativeId: campaign.id,
              durationType: campaign.durationType,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            },
          },
        })

        await tx.campaignRevenueRecognition.create({
          data: {
            creativeId: campaign.id,
            recognitionPeriodStart: periodStart,
            recognitionPeriodEnd: periodEnd,
            amount: amountToRecognize,
            revenueEventId: revenueEvent.id,
          },
        })

        await tx.adCreative.update({
          where: { id: campaign.id },
          data: {
            recognizedAmount: { increment: amountToRecognize },
            lastRecognizedAt: now,
            nextRecognitionAt: isLastDay ? null : nextRecognitionAt,
            campaignStatus: isLastDay ? 'COMPLETED' : 'ACTIVE',
          },
        })

        return { revenueEvent }
      })

      void settleRevenueEvent(revenueEvent.id).catch((err) =>
        console.error('[settlement] recognition error', revenueEvent.id, err)
      )

      results.push({ creativeId: campaign.id, status: isLastDay ? 'COMPLETED' : 'RECOGNIZED', ok: true, amount: amountToRecognize })
    } catch (err) {
      results.push({
        creativeId: campaign.id,
        status: 'ERROR',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Expire campaigns past their endAt (including any that were missed)
  await prisma.adCreative.updateMany({
    where: {
      campaignStatus: 'ACTIVE',
      campaignEndAt: { lte: now },
    },
    data: { campaignStatus: 'EXPIRED' },
  })

  // Expire corresponding rentals
  const expiredCreatives = await prisma.adCreative.findMany({
    where: { campaignStatus: { in: ['COMPLETED', 'EXPIRED'] }, durationType: { not: null } },
    select: { id: true },
  })
  if (expiredCreatives.length > 0) {
    await prisma.adRental.updateMany({
      where: {
        creativeId: { in: expiredCreatives.map((c) => c.id) },
        status: 'ACTIVE',
      },
      data: { status: 'EXPIRED', endDate: now },
    })
  }

  const succeeded = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  return NextResponse.json({
    recognized: results.length,
    succeeded,
    failed,
    results,
  })
}

export async function POST(req: Request) {
  return GET(req)
}
