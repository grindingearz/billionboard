import { prisma } from '@/lib/prisma'

export const SETTING_DEFAULTS = {
  daily_price_per_tile: '1.00',
  weekly_price_per_tile: '5.60',
  monthly_price_per_tile: '15.00',
  tile_price_usd_per_day: '1',      // legacy — kept for backward compat with per-day billing
  free_rental_enabled: 'false',
  free_rental_days: '0',
  management_fee_percent: '10',
  auto_approve_ads: 'true',
  trading_fee_distribution_enabled: 'false',
  ad_distribution_copy: '90% of recognized advertising revenue is allocated to eligible $BOARD holders. 10% goes to Treasury.',
  trading_fee_mode_copy: 'Trading fees are currently routed to Treasury for launch growth, marketing, boosts, prizes, and operations. Advertising revenue distribution remains active.',
  claims_status_copy: 'Claims activate after $BOARD launch and holder snapshots.',
  treasury_usage_copy: 'Treasury funds may be used for marketing, boosts, prizes, operations, liquidity support, and ecosystem growth.',
  homepage_banner_copy: '',
  stats_disclaimer_copy: 'Only recognized and settled revenue enters claim calculations. Top-ups, admin free ads, and unrecognized prepaid campaign value are not counted as distribution revenue.',
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

export interface CampaignPricing {
  dailyPricePerTile: number
  weeklyPricePerTile: number
  monthlyPricePerTile: number
}

export async function getCampaignPricing(): Promise<CampaignPricing> {
  const [daily, weekly, monthly] = await Promise.all([
    getSetting('daily_price_per_tile'),
    getSetting('weekly_price_per_tile'),
    getSetting('monthly_price_per_tile'),
  ])
  return {
    dailyPricePerTile: Math.max(0, parseFloat(daily) || 1.0),
    weeklyPricePerTile: Math.max(0, parseFloat(weekly) || 5.6),
    monthlyPricePerTile: Math.max(0, parseFloat(monthly) || 15.0),
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

export async function isAutoApproveEnabled(): Promise<boolean> {
  return (await getSetting('auto_approve_ads')) !== 'false'
}

export async function isTradingFeeDistributionEnabled(): Promise<boolean> {
  return (await getSetting('trading_fee_distribution_enabled')) === 'true'
}

export async function getFreeRentalDays(): Promise<number> {
  const val = await getSetting('free_rental_days')
  const n = parseInt(val, 10)
  return isNaN(n) || n < 0 ? 0 : n
}
