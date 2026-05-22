import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { getAllSettings, SETTING_DEFAULTS, type SettingKey } from '@/lib/settings'

export async function GET() {
  const settings = await getAllSettings()
  return NextResponse.json({ settings })
}

export async function PATCH(req: Request) {
  const session = await getSession()
  if (session?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as Record<string, unknown>
  const validKeys = Object.keys(SETTING_DEFAULTS) as SettingKey[]

  const updates: { key: string; value: string }[] = []
  for (const key of validKeys) {
    if (key in body && body[key] !== undefined && body[key] !== null) {
      updates.push({ key, value: String(body[key]) })
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid settings provided' }, { status: 400 })
  }

  await Promise.all(
    updates.map(({ key, value }) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  )

  const settings = await getAllSettings()
  return NextResponse.json({ settings })
}
