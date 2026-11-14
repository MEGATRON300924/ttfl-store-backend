const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS store_badges (id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE, badge TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(vendor_id, badge), CHECK (badge IN ('REGISTERED','VERIFIED','BUSINESS','ENTERPRISE','PLATINUM')))`);
  await prisma.$executeRawUnsafe(`ALTER TABLE store_badges DROP CONSTRAINT IF EXISTS store_badges_badge_check`);
  await prisma.$executeRawUnsafe(`ALTER TABLE store_badges ADD CONSTRAINT store_badges_badge_check CHECK (badge IN ('REGISTERED','VERIFIED','BUSINESS','ENTERPRISE','PLATINUM'))`);
  await prisma.$executeRawUnsafe(`INSERT INTO store_badges (id, vendor_id, badge) SELECT md5(vp.id || ':registered'), vp.id, 'REGISTERED' FROM vendor_profiles vp ON CONFLICT (vendor_id, badge) DO NOTHING`);
  console.log("Registered Store badge records synchronized. Legal badges are only granted by the legal verification review workflow.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
