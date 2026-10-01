const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS store_business_hours (
      vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
      day_of_week SMALLINT NOT NULL,
      is_open BOOLEAN NOT NULL DEFAULT TRUE,
      open_time TIME,
      close_time TIME,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(vendor_id,day_of_week),
      CHECK(day_of_week BETWEEN 0 AND 6),
      CHECK((is_open=FALSE) OR (open_time IS NOT NULL AND close_time IS NOT NULL))
    )`);
    console.log("Store business hours schema ready.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Store business hours schema failed:", error);
  process.exitCode = 1;
});
