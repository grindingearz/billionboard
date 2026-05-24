import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, walletMismatch } from '@/lib/auth'
import { TOTAL_TILES, isRectangularSelection } from '@/lib/types'
import { getTilePrice, isFreeRentalEnabled, isAutoApproveEnabled } from '@/lib/settings'
import { settleRevenueEvent } from '@/lib/settlement'
import { getOrCreateEpoch, utcDayStart } from '@/lib/epoch'
import { validateCampaignPrice, computeCampaignPrice, type DurationType } from '@/lib/campaign-pricing'

// Strips any existing protocol and ensures https:// prefix.
function normalizeDestUrl(raw: string): string {
  const stripped = raw.trim().replace(/^https?:\/\//i, '').replace(/^\/\//, '')
  return `https://${stripped}`
}

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (walletMismatch(session, req)) return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 })

  const rentals = await prisma.adRental.findMany({
    where: { userId: session.userId },
    include: { creative: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ rentals })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (walletMismatch(session, req)) return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 })

  const {
    tileIds,
    imageUrl,
    destUrl,
    altText,
    displayMode: rawDisplayMode,
    durationType,
    totalPrice: claimedTotal,
  } = await req.json()
  const displayMode = rawDisplayMode === 'STRETCH' ? 'STRETCH' : 'REPEAT'

  if (!Array.isArray(tileIds) || tileIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one tile' }, { status: 400 })
  }
  if (tileIds.length > 500) {
    return NextResponse.json({ error: 'Max 500 tiles per submission' }, { status: 400 })
  }
  for (const id of tileIds) {
    if (typeof id !== 'number' || id < 0 || id >= TOTAL_TILES) {
      return NextResponse.json({ error: `Invalid tileId: ${id}` }, { status: 400 })
    }
  }
  const uniqueTileIds: number[] = Array.from(new Set<number>(tileIds))
  if (!destUrl || !imageUrl) {
    return NextResponse.json({ error: 'imageUrl and destUrl required' }, { status: 400 })
  }
  if (displayMode === 'STRETCH' && !isRectangularSelection(uniqueTileIds)) {
    return NextResponse.json(
      { error: 'Stretch mode requires a rectangular block of connected tiles.' },
      { status: 400 }
    )
  }

  const normalizedDestUrl = normalizeDestUrl(destUrl)
  try {
    const parsed = new URL(normalizedDestUrl)
    if (!parsed.hostname.includes('.')) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Please enter a valid website URL.' }, { status: 400 })
  }
  try {
    new URL(imageUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })
  }

  // Check tiles are available
  const occupied = await prisma.adRental.findMany({
    where: {
      tileId: { in: uniqueTileIds },
      status: { in: ['PENDING_APPROVAL', 'ACTIVE'] },
    },
    select: { tileId: true },
  })
  if (occupied.length > 0) {
    return NextResponse.json(
      { error: 'Some tiles are already occupied', occupied: occupied.map((r) => r.tileId) },
      { status: 409 }
    )
  }

  const isCampaign = typeof durationType === 'string' && durationType !== ''

  if (isCampaign) {
    return handleCampaignRental(session.userId, {
      uniqueTileIds,
      imageUrl,
      normalizedDestUrl,
      altText,
      displayMode,
      durationType,
      claimedTotal: typeof claimedTotal === 'number' ? claimedTotal : 0,
    })
  }

  // --- Legacy per-day billing path ---
  const [tilePrice, freeEnabled, autoApprove] = await Promise.all([
    getTilePrice(),
    isFreeRentalEnabled(),
    isAutoApproveEnabled(),
  ])

  const dailyRate = freeEnabled ? 0 : tilePrice

  if (!freeEnabled && autoApprove) {
    const requiredCents = Math.round(uniqueTileIds.length * tilePrice * 100)
    const wallet = await prisma.advertiserWallet.findUnique({ where: { userId: session.userId } })
    const walletCents = Math.round(Number(wallet?.usdcBalance ?? 0) * 100)
    if (!wallet || walletCents < requiredCents) {
      const shortfall = Math.max(0, requiredCents - walletCents) / 100
      return NextResponse.json(
        {
          error: `Insufficient balance. Need $${(requiredCents / 100).toFixed(2)} USDC for first 24h. Shortfall: $${shortfall.toFixed(2)}`,
          required: requiredCents / 100,
          shortfall,
        },
        { status: 402 }
      )
    }
  } else if (!freeEnabled && !autoApprove) {
    const requiredCents = Math.round(uniqueTileIds.length * tilePrice * 100)
    const wallet = await prisma.advertiserWallet.findUnique({ where: { userId: session.userId } })
    const walletCents = Math.round(Number(wallet?.usdcBalance ?? 0) * 100)
    if (!wallet || walletCents < requiredCents) {
      const shortfall = Math.max(0, requiredCents - walletCents) / 100
      return NextResponse.json(
        {
          error: `Insufficient balance. Need $${(requiredCents / 100).toFixed(2)} USDC to submit. Shortfall: $${shortfall.toFixed(2)}`,
          required: requiredCents / 100,
          shortfall,
        },
        { status: 402 }
      )
    }
  }

  const now = new Date()
  const first24hCost = freeEnabled ? 0 : uniqueTileIds.length * dailyRate

  let epochId: string | null = null
  if (autoApprove && !freeEnabled && first24hCost > 0) {
    const epoch = await getOrCreateEpoch(utcDayStart(now))
    epochId = epoch.id
  }

  const result = await prisma.$transaction(async (tx) => {
    const creative = await tx.adCreative.create({
      data: { userId: session.userId, imageUrl, destUrl: normalizedDestUrl, altText: altText ?? null, displayMode },
    })

    const rentals = await Promise.all(
      uniqueTileIds.map((tileId: number) =>
        tx.adRental.create({
          data: {
            userId: session.userId,
            tileId,
            creativeId: creative.id,
            status: autoApprove ? 'ACTIVE' : 'PENDING_APPROVAL',
            startDate: autoApprove ? now : null,
            lastBilledAt: autoApprove ? now : null,
            nextBillingAt: autoApprove ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : null,
            dailyRate,
          },
        })
      )
    )

    let revenueEvent = null
    if (autoApprove && !freeEnabled && first24hCost > 0) {
      await tx.advertiserWallet.update({
        where: { userId: session.userId },
        data: { usdcBalance: { decrement: first24hCost } },
      })

      revenueEvent = await tx.revenueEvent.create({
        data: {
          type: 'AD_RENT_REVENUE',
          source: 'activation',
          amount: first24hCost,
          currency: 'USDC',
          epochId,
          userId: session.userId,
          metadata: {
            tileCount: uniqueTileIds.length,
            creativeId: creative.id,
            dailyRate,
          },
        },
      })
    }

    return { creative, rentals, revenueEvent }
  })

  if (result.revenueEvent) {
    void settleRevenueEvent(result.revenueEvent.id).catch((err) =>
      console.error('[settlement] activation error', result.revenueEvent?.id, err)
    )
  }

  return NextResponse.json(
    { ok: true, rentalCount: result.rentals.length, autoApproved: autoApprove },
    { status: 201 }
  )
}

async function handleCampaignRental(
  userId: string,
  opts: {
    uniqueTileIds: number[]
    imageUrl: string
    normalizedDestUrl: string
    altText?: string
    displayMode: 'REPEAT' | 'STRETCH'
    durationType: string
    claimedTotal: number
  }
) {
  const { uniqueTileIds, imageUrl, normalizedDestUrl, altText, displayMode, durationType, claimedTotal } = opts

  const validation = validateCampaignPrice(durationType, uniqueTileIds.length, claimedTotal)
  if (!validation.valid || !validation.computed) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const { durationDays, totalPrice, dailyRecognizedRevenue } = validation.computed

  const wallet = await prisma.advertiserWallet.findUnique({ where: { userId } })
  const walletCents = Math.round(Number(wallet?.usdcBalance ?? 0) * 100)
  const requiredCents = Math.round(totalPrice * 100)
  if (!wallet || walletCents < requiredCents) {
    const shortfall = Math.max(0, requiredCents - walletCents) / 100
    return NextResponse.json(
      {
        error: `Insufficient balance. Need $${totalPrice.toFixed(2)} USDC for this campaign. Shortfall: $${shortfall.toFixed(2)}`,
        required: totalPrice,
        shortfall,
      },
      { status: 402 }
    )
  }

  const now = new Date()
  const campaignEndAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)
  const periodStart = utcDayStart(now)
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000 - 1)

  const epoch = await getOrCreateEpoch(periodStart)

  const result = await prisma.$transaction(async (tx) => {
    const creative = await tx.adCreative.create({
      data: {
        userId,
        imageUrl,
        destUrl: normalizedDestUrl,
        altText: altText ?? null,
        displayMode,
        durationType: durationType as DurationType,
        durationDays,
        totalPrice,
        prepaidAmount: totalPrice,
        recognizedAmount: dailyRecognizedRevenue,
        dailyRecognizedRevenue,
        campaignStartAt: now,
        campaignEndAt,
        lastRecognizedAt: now,
        nextRecognitionAt: new Date(periodStart.getTime() + 24 * 60 * 60 * 1000),
        campaignStatus: 'ACTIVE',
      },
    })

    const rentals = await Promise.all(
      uniqueTileIds.map((tileId: number) =>
        tx.adRental.create({
          data: {
            userId,
            tileId,
            creativeId: creative.id,
            status: 'ACTIVE',
            startDate: now,
            // No nextBillingAt — campaign billing handled by recognition job
            dailyRate: dailyRecognizedRevenue / uniqueTileIds.length,
          },
        })
      )
    )

    // Deduct full campaign price upfront
    await tx.advertiserWallet.update({
      where: { userId },
      data: { usdcBalance: { decrement: totalPrice } },
    })

    // First day recognition event
    const revenueEvent = await tx.revenueEvent.create({
      data: {
        type: 'AD_RENT_REVENUE',
        source: 'activation',
        amount: dailyRecognizedRevenue,
        currency: 'USDC',
        epochId: epoch.id,
        userId,
        metadata: {
          tileCount: uniqueTileIds.length,
          creativeId: creative.id,
          durationType,
          durationDays,
          totalPrice,
          recognitionDay: 1,
        },
      },
    })

    // Idempotency record for first day
    await tx.campaignRevenueRecognition.create({
      data: {
        creativeId: creative.id,
        recognitionPeriodStart: periodStart,
        recognitionPeriodEnd: periodEnd,
        amount: dailyRecognizedRevenue,
        revenueEventId: revenueEvent.id,
      },
    })

    return { creative, rentals, revenueEvent }
  })

  void settleRevenueEvent(result.revenueEvent.id).catch((err) =>
    console.error('[settlement] campaign activation error', result.revenueEvent.id, err)
  )

  return NextResponse.json(
    {
      ok: true,
      rentalCount: result.rentals.length,
      autoApproved: true,
      campaign: {
        durationType,
        durationDays,
        totalPrice,
        campaignStartAt: result.creative.campaignStartAt,
        campaignEndAt: result.creative.campaignEndAt,
      },
    },
    { status: 201 }
  )
}

export async function DELETE(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (walletMismatch(session, req)) return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 })

  const { rentalId } = await req.json()
  const rental = await prisma.adRental.findUnique({ where: { id: rentalId } })

  if (!rental || rental.userId !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (rental.status === 'EXPIRED' || rental.status === 'REJECTED') {
    return NextResponse.json({ error: 'Rental already closed' }, { status: 400 })
  }

  await prisma.adRental.update({
    where: { id: rentalId },
    data: { status: 'EXPIRED', endDate: new Date() },
  })

  return NextResponse.json({ ok: true })
}
