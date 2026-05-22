import { prisma } from '@/lib/prisma'

export const SETTING_DEFAULTS = {
  tile_price_usd_per_day: '1',
  free_rental_enabled: 'false',
  free_rental_days: '0',
  management_fee_percent: '10',
} as const

export type SettingKey = keyof typeof SETTING_DEFAULTS

export async function getAllSettings(): Promise<Record<SettingKey, string>> {
  const result = { ...SETTING_DEFAULTS } as Record<SettingKey, string>
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.keys(SETTING_DEFAULTS) } },
    })
    for (const row of rows) {
      if (row.key in result) result[row.key as SettingKey] = row.value
    }
  } catch { /* fall through to defaults */ }
  return result
}

export async function getSetting(key: SettingKey): Promise<string> {
  try {
    const s = await prisma.setting.findUnique({ where: { key } })
    return s?.value ?? SETTING_DEFAULTS[key]
  } catch {
    return SETTING_DEFAULTS[key]
  }
}

export async function getTilePrice(): Promise<number> {
  const val = await getSetting('tile_price_usd_per_day')
  const n = parseFloat(val)
  return isNaN(n) || n < 0 ? 1 : n
}

export async function isFreeRentalEnabled(): Promise<boolean> {
  return (await getSetting('free_rental_enabled')) === 'true'
}

export async function getFreeRentalDays(): Promise<number> {
  const val = await getSetting('free_rental_days')
  const n = parseInt(val, 10)
  return isNaN(n) || n < 0 ? 0 : n
}
