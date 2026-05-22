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
  const value = process.env[name]
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
  return process.env[name] ?? null
}

function withDefault(name: string, fallback: string): string {
  return process.env[name] ?? fallback
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
    return withDefault('SESSION_SECRET', 'dev-secret-CHANGE-IN-PROD-billionboard-2024')
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
  /** Pump.fun creator fee wallet. Null until token launches. */
  get feeCreatorWallet(): string | null {
    return optional('FEE_CREATOR_WALLET')
  },
  get adRevenueWallet(): string | null {
    return optional('AD_REVENUE_WALLET')
  },
  get managementWallet(): string | null {
    return optional('MANAGEMENT_WALLET')
  },
  /** Hot wallet for outbound USDC claim payouts. Null until payout flow is implemented. */
  get distributionWallet(): string | null {
    return optional('DISTRIBUTION_WALLET')
  },
  get treasuryWallet(): string | null {
    return optional('TREASURY_WALLET')
  },
  /**
   * Private key for the distribution wallet.
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
