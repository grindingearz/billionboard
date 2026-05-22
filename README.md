# BillionBoard

1,000,000,000 pixel internet billboard powered by $BOARD on Solana.

## Stack

- **Next.js 16** App Router + TypeScript
- **Tailwind CSS v4**
- **Prisma 7** + PostgreSQL (via `@prisma/adapter-pg`)
- **jose** — JWT session cookies
- Auth: email-based mock (Privy placeholder)
- Payments: mock USDC top-up (real USDC on-chain TODO)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD (see ENV_SETUP.md)

# 3. Push schema to DB
npm run db:push

# 4. (Optional) Seed demo data
npm run db:seed

# 5. Start dev server
npm run dev
```

## Environment setup

See **[ENV_SETUP.md](./ENV_SETUP.md)** for full instructions covering:
- Local development (`.env.local`)
- Vercel environment variables
- Railway worker/Postgres variables
- Security warnings and wallet key hygiene

All variables are typed and validated by `lib/env.ts`. Missing critical variables throw a descriptive error at startup in production.

## Routes

| Route | Description |
|-------|-------------|
| `/` | Public billboard homepage |
| `/advertise` | Advertiser dashboard — log in, top up, select tiles, submit ad |
| `/claim` | Holder dashboard — check $BOARD balance, claim USDC |
| `/stats` | Public revenue and epoch stats |
| `/admin` | Admin dashboard — approve/reject ads, run billing, manage epochs |

## API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tiles` | GET | All occupied tile statuses (sparse) |
| `/api/tiles/[id]` | GET | Single tile detail |
| `/api/auth` | POST/DELETE | Log in / log out |
| `/api/topup` | GET/POST | Balance + mock USDC top-up |
| `/api/rentals` | GET/POST/DELETE | Manage ad rentals |
| `/api/stats` | GET | Aggregated revenue stats |
| `/api/claims` | GET/POST | View and execute USDC claims |
| `/api/admin` | GET/POST | Admin actions (auth required) |
| `/api/billing` | POST | Trigger daily billing run |

## Data models

`User` → `AdvertiserWallet` → `Topup`, `AdRental` → `AdCreative`
`DailyBillingRun` → `RevenueEvent`
`DistributionEpoch` → `HolderSnapshot`, `Claim`
`ExcludedWallet`

## TODOs (marked in code)

- `// TODO: real USDC on-chain detection` — replace mock top-up with Solana tx detection
- `// TODO: real Privy/Phantom wallet connect` — swap email auth for wallet connect
- `// TODO: real $BOARD token mint address` — set `BOARD_TOKEN_MINT` in env after Pump.fun launch
- `// TODO: real Solana token holder indexing` — replace mock snapshot with on-chain balance query
- `// TODO: real Solana USDC transfer` — execute actual claim transaction
- `// TODO: Pump.fun creator fee wallet tracking` — index fee revenue from `PUMPFUN_FEE_WALLET`
- `// TODO: file upload` — replace image URL input with Vercel Blob or similar
