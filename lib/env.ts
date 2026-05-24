/**
 * Validated environment variable access.
 *
 * Import this only in server-side code (Server Components, Route Handlers,
 * Server Functions, server-only utilities). Importing it in a Client Component
 * will bundle server secrets into the browser JavaScript.
 *
 * Server-only required vars use getters so validation throws at request time,
 * not at module-load / build time. NEXT_PUBLIC_ vars have simple defaults
 * since Next.js bakes them in at build time.
 */

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Add it to your Vercel project settings or Railway service variables.\n` +
        `See ENV_SETUP.md for details.`
    )
  }
  return value ?? ''
}

function optional(name: string): string | null {
  const v = process.env[name]?.trim()
  return v || null
}

function withDefault(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

export const env = {
  // ── Public (NEXT_PUBLIC_ — baked into the bundle at build time) ───────────
  // These use simple defaults, never throw at runtime.

  appUrl: withDefault('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  projectName: withDefault('NEXT_PUBLIC_PROJECT_NAME', 'BillionBoard'),
  tokenTicker: withDefault('NEXT_PUBLIC_TOKEN_TICKER', 'BOARD'),
  tilePriceUsd: Number(withDefault('NEXT_PUBLIC_TILE_PRICE_USD', '1')),
  totalTiles: Number(withDefault('NEXT_PUBLIC_TOTAL_TILES', '100000')),
  totalPixels: Number(withDefault('NEXT_PUBLIC_TOTAL_PIXELS', '1000000000')),
  solanaNetwork: withDefault('NEXT_PUBLIC_SOLANA_NETWORK', 'mainnet-beta'),
  /** Null until $BOARD token launches on Pump.fun. Check before using. */
  boardMint: optional('NEXT_PUBLIC_BOARD_MINT'),
  usdcMint: optional('NEXT_PUBLIC_USDC_MINT'),
  privyAppId: optional('NEXT_PUBLIC_PRIVY_APP_ID'),
  gaId: optional('NEXT_PUBLIC_GA_ID'),
  posthogKey: optional('NEXT_PUBLIC_POSTHOG_KEY'),
  posthogHost: withDefault('NEXT_PUBLIC_POSTHOG_HOST', 'https://app.posthog.com'),

  // ── Server-only required — getters so validation fires at request time ─────
  // Accessing these without the variable set in production throws immediately
  // with a clear message. They are NOT evaluated during `next build`.

  get databaseUrl(): string {
    return required('DATABASE_URL')
  },
  get sessionSecret(): string {
    const val = process.env.SESSION_SECRET?.trim()
    if (!val) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Missing required environment variable: SESSION_SECRET\n' +
          'Add a long random secret to your Vercel project settings.'
        )
      }
      return 'dev-secret-change-in-production'
    }
    return val
  },
  get adminPassword(): string | null {
    return optional('ADMIN_PASSWORD')
  },
  get adminEmail(): string | null {
    return optional('ADMIN_EMAIL')
  },
  get cronSecret(): string | null {
    return optional('CRON_SECRET')
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  get privyAppSecret(): string | null {
    return optional('PRIVY_APP_SECRET')
  },

  // ── Solana / indexing ─────────────────────────────────────────────────────
  get heliusApiKey(): string | null {
    return optional('HELIUS_API_KEY')
  },
  get heliusRpcUrl(): string | null {
    return optional('HELIUS_RPC_URL')
  },

  // ── Project wallets ───────────────────────────────────────────────────────
  get adminWallet(): string | null {
    return optional('ADMIN_WALLET')
  },
  /** Pump.fun creator fee wallet. Receives trading fee inflows after $BOARD launch. */
  get feeCreatorWallet(): string | null {
    return optional('FEE_CREATOR_WALLET')
  },
  /**
   * Top-Up Wallet — receives advertiser USDC deposits.
   * Falls back to AD_REVENUE_WALLET for backward compatibility.
   * Top-ups are prepaid advertiser balances, NOT revenue.
   */
  get topupWallet(): string | null {
    return optional('TOPUP_WALLET') ?? optional('AD_REVENUE_WALLET')
  },
  /** Legacy alias — prefer topupWallet. Kept so existing code referencing adRevenueWallet still works. */
  get adRevenueWallet(): string | null {
    return optional('TOPUP_WALLET') ?? optional('AD_REVENUE_WALLET')
  },
  /** Revenue Wallet — staging wallet for earned revenue only. Never receives raw advertiser deposits. */
  get revenueWallet(): string | null {
    return optional('REVENUE_WALLET')
  },
  get managementWallet(): string | null {
    return optional('MANAGEMENT_WALLET')
  },
  /** Distribution Wallet — receives 90% holder claim pool. */
  get distributionWallet(): string | null {
    return optional('DISTRIBUTION_WALLET')
  },
  /** Treasury Wallet — receives 10% platform fee. */
  get treasuryWallet(): string | null {
    return optional('TREASURY_WALLET')
  },

  // ── Settlement private keys (server-side only, never expose) ─────────────
  /**
   * Private key for the Top-Up Wallet (signer for source→revenue transfer).
   * Falls back to AD_REVENUE_WALLET_PRIVATE_KEY for backward compatibility.
   * JSON array [1,2,…64] or base64. Never log or include in API responses.
   */
  get topupWalletPrivateKey(): string | null {
    return optional('TOPUP_WALLET_PRIVATE_KEY') ?? optional('AD_REVENUE_WALLET_PRIVATE_KEY')
  },
  /**
   * Private key for the Revenue Wallet (signer for revenue→treasury + distribution splits).
   * JSON array [1,2,…64] or base64.
   */
  get revenueWalletPrivateKey(): string | null {
    return optional('REVENUE_WALLET_PRIVATE_KEY')
  },
  /**
   * Private key for the Fee Creator Wallet (signer for trading-fee→revenue transfer).
   * Optional — if missing, trading fee settlement stays pending/manual.
   */
  get feeCreatorWalletPrivateKey(): string | null {
    return optional('FEE_CREATOR_WALLET_PRIVATE_KEY')
  },
  /**
   * Private key for the distribution wallet (payout to holders).
   * Null until the payout flow is implemented securely.
   * Never log, expose in errors, or include in API responses.
   */
  get distributionWalletPrivateKey(): string | null {
    return optional('DISTRIBUTION_WALLET_PRIVATE_KEY')
  },

  // ── Cloudflare R2 ─────────────────────────────────────────────────────────
  get r2AccountId(): string | null {
    return optional('R2_ACCOUNT_ID')
  },
  get r2AccessKeyId(): string | null {
    return optional('R2_ACCESS_KEY_ID')
  },
  get r2SecretAccessKey(): string | null {
    return optional('R2_SECRET_ACCESS_KEY')
  },
  get r2BucketName(): string | null {
    return optional('R2_BUCKET_NAME')
  },
  get r2PublicUrl(): string | null {
    return optional('R2_PUBLIC_URL')
  },
}

export type Env = typeof env
