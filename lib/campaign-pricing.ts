export const CAMPAIGN_PACKAGES = {
  DAILY: { days: 1, totalPerTile: 1.0, dailyPerTile: 1.0 },
  WEEKLY: { days: 7, totalPerTile: 5.6, dailyPerTile: 0.8 },
  MONTHLY: { days: 30, totalPerTile: 15.0, dailyPerTile: 0.5 },
} as const

export type DurationType = keyof typeof CAMPAIGN_PACKAGES

export function computeCampaignPrice(durationType: DurationType, tileCount: number) {
  const pkg = CAMPAIGN_PACKAGES[durationType]
  const totalPrice = Math.round(tileCount * pkg.totalPerTile * 100) / 100
  const dailyRecognizedRevenue = Math.round(tileCount * pkg.dailyPerTile * 100) / 100
  return {
    durationDays: pkg.days,
    totalPrice,
    dailyRecognizedRevenue,
  }
}

export function validateCampaignPrice(
  durationType: string,
  tileCount: number,
  claimedTotal: number,
): { valid: boolean; error?: string; computed?: ReturnType<typeof computeCampaignPrice> } {
  if (!(durationType in CAMPAIGN_PACKAGES)) {
    return { valid: false, error: `Invalid durationType: ${durationType}` }
  }
  if (tileCount < 1) {
    return { valid: false, error: 'Must select at least one tile' }
  }
  const computed = computeCampaignPrice(durationType as DurationType, tileCount)
  if (Math.abs(computed.totalPrice - claimedTotal) > 0.01) {
    return {
      valid: false,
      error: `Price mismatch: expected ${computed.totalPrice}, got ${claimedTotal}`,
    }
  }
  return { valid: true, computed }
}
