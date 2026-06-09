import { prisma } from '@/lib/prisma'

const VALID_TYPES = new Set(['PAGE_VIEW', 'BOARD_VIEW'])

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const type = typeof body.type === 'string' ? body.type : ''

    if (!VALID_TYPES.has(type)) {
      return new Response(null, { status: 204 })
    }

    const path = typeof body.path === 'string' ? body.path.slice(0, 256) : '/'
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : null
    const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 512) : null

    void prisma.trafficEvent.create({ data: { type, path, sessionId, referrer } }).catch(() => {})
  } catch {
    // always silent
  }
  return new Response(null, { status: 204 })
}
