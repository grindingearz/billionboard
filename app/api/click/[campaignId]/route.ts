import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params

  const creative = await prisma.adCreative.findUnique({
    where: { id: campaignId },
    select: { destUrl: true, campaignStatus: true, durationType: true },
  })

  if (!creative || !creative.destUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // For campaign ads, only redirect if still active
  if (creative.durationType && creative.campaignStatus === 'EXPIRED') {
    return NextResponse.json({ error: 'Campaign expired' }, { status: 410 })
  }

  const url = new URL(req.url)
  const tileId = url.searchParams.get('t')

  // Fire-and-forget click record
  void prisma.clickEvent
    .create({
      data: {
        creativeId: campaignId,
        tileId: tileId ? parseInt(tileId, 10) : null,
        referrer: req.headers.get('referer') ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
    })
    .catch(() => {})

  return new Response(null, {
    status: 302,
    headers: { Location: creative.destUrl },
  })
}
