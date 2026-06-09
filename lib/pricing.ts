/**
 * Server-side campaign pricing — reads from DB settings with safe defaults.
 * Import this on the server only; it uses DB access.
 * Client-side: fetch daily/weekly/monthly_price_per_tile from /api/settings.
 */
import { getCampaignPricing } from './settings'

export type DurationType = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export interface CampaignPrice {
  durationDays: number
  totalPrice: number
  dailyRecognizedRevenue: number
}

function buildPackages(p: { dailyPricePerTile: number; weeklyPricePerTile: number; monthlyPricePerTile: number }) {
  return {
    DAILY: { days: 1, totalPerTile: p.dailyPricePerTile, dailyPerTile: p.dailyPricePerTile },
    WEEKLY: { days: 7, totalPerTile: p.weeklyPricePerTile, dailyPerTile: p.weeklyPricePerTile / 7 },
    MONTHLY: { days: 30, totalPerTile: p.monthlyPricePerTile, dailyPerTile: p.monthlyPricePerTile / 30 },
  }
}

export async function calculateCampaignPrice(
  durationType: DurationType,
  tileCount: number,
): Promise<CampaignPrice> {
  const pricing = await getCampaignPricing()
  const pkg = buildPackages(pricing)[durationType]
  return {
    durationDays: pkg.days,
    totalPrice: Math.round(tileCount * pkg.totalPerTile * 100) / 100,
    dailyRecognizedRevenue: Math.round(tileCount * pkg.dailyPerTile * 100) / 100,
  }
}

export async function validateCampaignPrice(
  durationType: string,
  tileCount: number,
  claimedTotal: number,
): Promise<{ valid: boolean; error?: string; computed?: CampaignPrice }> {
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(durationType)) {
    return { valid: false, error: `Invalid durationType: ${durationType}` }
  }
  if (tileCount < 1) {
    return { valid: false, error: 'Must select at least one tile' }
  }
  const computed = await calculateCampaignPrice(durationType as DurationType, tileCount)
  if (Math.abs(computed.totalPrice - claimedTotal) > 0.01) {
    return { valid: false, error: `Price mismatch: expected ${computed.totalPrice}, got ${claimedTotal}` }
  }
  return { valid: true, computed }
}
