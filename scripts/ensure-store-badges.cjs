const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS store_badges (id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE, badge TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(vendor_id, badge), CHECK (badge IN ('VERIFIED','BUSINESS','ENTERPRISE','PLATINUM')))`);
  await prisma.$executeRawUnsafe(`INSERT INTO store_badges (id, vendor_id, badge) SELECT md5(random()::text || clock_timestamp()::text || vp.id), vp.id, 'VERIFIED' FROM vendor_profiles vp WHERE vp.verified = true ON CONFLICT (vendor_id, badge) DO NOTHING`);
  console.log("Store badge records synchronized.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
