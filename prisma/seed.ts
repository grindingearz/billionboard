/**
 * Seed script — run with: npx prisma db seed
 * Creates a demo admin user and a few sample ad rentals for local dev.
 */
import { PrismaClient } from '../app/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@billionboard.internal' },
    update: {},
    create: { email: 'admin@billionboard.internal', role: 'ADMIN' },
  })
  console.log('Admin:', admin.id)

  // Demo advertiser
  const advertiser = await prisma.user.upsert({
    where: { email: 'demo@advertiser.com' },
    update: {},
    create: { email: 'demo@advertiser.com', role: 'ADVERTISER' },
  })
  await prisma.advertiserWallet.upsert({
    where: { userId: advertiser.id },
    update: {},
    create: { userId: advertiser.id, usdcBalance: 500 },
  })

  // A sample active creative + rental on tile 0
  const creative = await prisma.adCreative.create({
    data: {
      userId: advertiser.id,
      imageUrl: 'https://placehold.co/100x100/16a34a/ffffff?text=AD',
      destUrl: 'https://example.com',
      altText: 'Demo ad',
    },
  })
  await prisma.adRental.upsert({
    where: { id: 'seed-rental-1' },
    update: {},
    create: {
      id: 'seed-rental-1',
      userId: advertiser.id,
      tileId: 0,
      creativeId: creative.id,
      status: 'ACTIVE',
      startDate: new Date(),
      dailyRate: 1,
    },
  })

  console.log('Seed complete.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
