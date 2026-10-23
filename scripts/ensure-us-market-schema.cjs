const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  // Additive-only compatibility changes: existing vendors remain Nigeria-only
  // until they explicitly enable another market. Existing product prices stay NGN.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS customer_markets TEXT[] NOT NULL DEFAULT ARRAY['NG']::TEXT[]
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "vendor_profiles"
    ADD COLUMN IF NOT EXISTS supported_countries TEXT[] NOT NULL DEFAULT ARRAY['NG']::TEXT[]
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS us_price NUMERIC(12, 2)
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS us_previous_price NUMERIC(12, 2)
  `);
  console.log("US market columns are present; existing records were preserved.");
}

main()
  .catch((error) => {
    console.error("US market schema check failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
