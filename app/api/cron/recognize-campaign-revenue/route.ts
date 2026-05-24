import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { settleRevenueEvent } from '@/lib/settlement'
import { getOrCreateEpoch, utcDayStart } from '@/lib/epoch'
import { captureAppError } from '@/lib/sentry'

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
  const epoch = await getOrCreateEpoch(periodStart)

  // ── Phase 1: daily recognition for active in-progress campaigns ──────────────
  const recognitionResults: Array<{
    creativeId: string
    status: string
    ok: boolean
    amount?: number
    error?: string
  }> = []

  const activeCampaigns = await prisma.adCreative.findMany({
    where: {
      campaignStatus: 'ACTIVE',
      durationType: { not: null },
      nextRecognitionAt: { lte: now },
      campaignEndAt: { gt: now },
    },
    select: {
      id: true,
      userId: true,
      durationType: true,
      totalPrice: true,
      recognizedAmount: true,
      dailyRecognizedRevenue: true,
    },
  })

  for (const campaign of activeCampaigns) {
    try {
      const existing = await prisma.campaignRevenueRecognition.findUnique({
        where: {
          creativeId_recognitionPeriodStart: {
            creativeId: campaign.id,
            recognitionPeriodStart: periodStart,
          },
        },
      })
      if (existing) {
        recognitionResults.push({ creativeId: campaign.id, status: 'ALREADY_RECOGNIZED', ok: true, amount: 0 })
        continue
      }

      const totalPrice = Number(campaign.totalPrice ?? 0)
      const recognized = Number(campaign.recognizedAmount ?? 0)
      const daily = Number(campaign.dailyRecognizedRevenue ?? 0)
      const remaining = totalPrice - recognized

      if (remaining <= 0.001) {
        // All revenue recognized for this cycle; wait for Phase 2 to handle renewal at endAt
        recognitionResults.push({ creativeId: campaign.id, status: 'CYCLE_COMPLETE_PENDING_RENEWAL', ok: true, amount: 0 })
        continue
      }

      const amountToRecognize = Math.min(daily, remaining)
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
            nextRecognitionAt,
          },
        })

        return { revenueEvent }
      })

      void settleRevenueEvent(revenueEvent.id).catch((err) => {
        console.error('[settlement] recognition error', revenueEvent.id, err)
        captureAppError(err, { cronJob: 'recognize-campaign-revenue', revenueEventId: revenueEvent.id, creativeId: campaign.id, status: 'settlement_error' })
      })

      recognitionResults.push({ creativeId: campaign.id, status: 'RECOGNIZED', ok: true, amount: amountToRecognize })
    } catch (err) {
      captureAppError(err, { cronJob: 'recognize-campaign-revenue', creativeId: campaign.id, status: 'ERROR' })
      recognitionResults.push({
        creativeId: campaign.id,
        status: 'ERROR',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Phase 2: renewal / expiry for campaigns that have reached their endAt ────
  const renewalResults: Array<{
    creativeId: string
    status: string
    ok: boolean
    error?: string
  }> = []

  const endedCampaigns = await prisma.adCreative.findMany({
    where: {
      campaignStatus: 'ACTIVE',
      durationType: { not: null },
      campaignEndAt: { lte: now },
    },
    select: {
      id: true,
      userId: true,
      durationType: true,
      durationDays: true,
      totalPrice: true,
      dailyRecognizedRevenue: true,
      campaignEndAt: true,
      autoRenew: true,
      renewalCount: true,
    },
  })

  for (const campaign of endedCampaigns) {
    try {
      const cycleEndAt = campaign.campaignEndAt!

      // Idempotency: skip if already processed this cycle end
      const alreadyRenewed = await prisma.campaignRenewal.findUnique({
        where: { creativeId_cycleEndAt: { creativeId: campaign.id, cycleEndAt } },
      })
      if (alreadyRenewed) {
        renewalResults.push({ creativeId: campaign.id, status: 'ALREADY_PROCESSED', ok: true })
        continue
      }

      const shouldRenew = campaign.autoRenew

      if (shouldRenew) {
        const wallet = await prisma.advertiserWallet.findUnique({ where: { userId: campaign.userId } })
        const totalPrice = Number(campaign.totalPrice ?? 0)
        const balanceCents = Math.round(Number(wallet?.usdcBalance ?? 0) * 100)
        const requiredCents = Math.round(totalPrice * 100)

        if (!wallet || balanceCents < requiredCents) {
          // Insufficient balance — expire
          await expireCampaign(campaign.id, now)
          renewalResults.push({ creativeId: campaign.id, status: 'EXPIRED_INSUFFICIENT_BALANCE', ok: true })
          continue
        }

        // Renew: extend campaign by same duration
        const durationMs = (campaign.durationDays ?? 1) * 24 * 60 * 60 * 1000
        const newCycleStartAt = cycleEndAt
        const newCampaignEndAt = new Date(cycleEndAt.getTime() + durationMs)
        const newNextRecognitionAt = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000) // tomorrow
        const newCycleNumber = campaign.renewalCount + 1

        const revenueEvent = await prisma.$transaction(async (tx) => {
          // Deduct full campaign price
          await tx.advertiserWallet.update({
            where: { userId: campaign.userId },
            data: { usdcBalance: { decrement: totalPrice } },
          })

          // Idempotency record for this renewal
          await tx.campaignRenewal.create({
            data: {
              creativeId: campaign.id,
              cycleNumber: newCycleNumber,
              cycleStartAt: newCycleStartAt,
              cycleEndAt,
              totalPrice,
            },
          })

          // Reset cycle on the creative
          await tx.adCreative.update({
            where: { id: campaign.id },
            data: {
              campaignStatus: 'ACTIVE',
              campaignStartAt: newCycleStartAt,
              campaignEndAt: newCampaignEndAt,
              recognizedAmount: 0,
              lastRecognizedAt: now,
              nextRecognitionAt: newNextRecognitionAt,
              renewalCount: { increment: 1 },
            },
          })

          // First recognition event for the new cycle (today's period)
          // Phase 1 skipped this campaign because campaignEndAt <= now, so today's slot is free
          const revenueEvent = await tx.revenueEvent.create({
            data: {
              type: 'AD_RENT_REVENUE',
              source: 'activation',
              amount: Number(campaign.dailyRecognizedRevenue ?? 0),
              currency: 'USDC',
              epochId: epoch.id,
              userId: campaign.userId,
              metadata: {
                creativeId: campaign.id,
                durationType: campaign.durationType,
                renewal: true,
                cycleNumber: newCycleNumber,
                periodStart: periodStart.toISOString(),
              },
            },
          })

          await tx.campaignRevenueRecognition.create({
            data: {
              creativeId: campaign.id,
              recognitionPeriodStart: periodStart,
              recognitionPeriodEnd: periodEnd,
              amount: Number(campaign.dailyRecognizedRevenue ?? 0),
              revenueEventId: revenueEvent.id,
            },
          })

          // Update recognizedAmount for day 1 of new cycle
          await tx.adCreative.update({
            where: { id: campaign.id },
            data: { recognizedAmount: Number(campaign.dailyRecognizedRevenue ?? 0) },
          })

          return revenueEvent
        })

        void settleRevenueEvent(revenueEvent.id).catch((err) => {
          console.error('[settlement] renewal error', revenueEvent.id, err)
          captureAppError(err, { cronJob: 'recognize-campaign-revenue', revenueEventId: revenueEvent.id, creativeId: campaign.id, status: 'renewal_settlement_error' })
        })

        renewalResults.push({ creativeId: campaign.id, status: 'RENEWED', ok: true })
      } else {
        // autoRenew = false → expire
        await prisma.$transaction(async (tx) => {
          // Create a CampaignRenewal tombstone to mark this cycle as processed
          await tx.campaignRenewal.create({
            data: {
              creativeId: campaign.id,
              cycleNumber: campaign.renewalCount,
              cycleStartAt: campaign.campaignEndAt!,
              cycleEndAt,
              totalPrice: Number(campaign.totalPrice ?? 0),
            },
          })
          await expireCampaignTx(tx, campaign.id, now)
        })
        renewalResults.push({ creativeId: campaign.id, status: 'EXPIRED_NO_AUTORENEW', ok: true })
      }
    } catch (err) {
      captureAppError(err, { cronJob: 'recognize-campaign-revenue', creativeId: campaign.id, status: 'RENEWAL_ERROR' })
      renewalResults.push({
        creativeId: campaign.id,
        status: 'ERROR',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    recognized: recognitionResults.length,
    renewals: renewalResults.length,
    recognitionResults,
    renewalResults,
  })
}

async function expireCampaign(creativeId: string, now: Date) {
  await prisma.$transaction(async (tx) => {
    await expireCampaignTx(tx, creativeId, now)
  })
}

async function expireCampaignTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  creativeId: string,
  now: Date
) {
  await tx.adCreative.update({
    where: { id: creativeId },
    data: { campaignStatus: 'EXPIRED' },
  })
  await tx.adRental.updateMany({
    where: { creativeId, status: 'ACTIVE' },
    data: { status: 'EXPIRED', endDate: now },
  })
}

export async function POST(req: Request) {
  return GET(req)
}
