const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
    ORDER BY ordinal_position
  `);

  const names = new Set(columns.map((row) => row.column_name));

  if (names.has("vendor_id")) {
    console.log("Products vendor_id column already exists.");
    return;
  }

  if (names.has("vendorId")) {
    await prisma.$executeRawUnsafe('ALTER TABLE "products" RENAME COLUMN "vendorId" TO "vendor_id"');
    console.log('Renamed products."vendorId" to products.vendor_id.');
    return;
  }

  if (names.has("vendorid")) {
    await prisma.$executeRawUnsafe('ALTER TABLE "products" RENAME COLUMN "vendorid" TO "vendor_id"');
    console.log("Renamed products.vendorid to products.vendor_id.");
    return;
  }

  throw new Error(
    `The products table has no vendor_id column and no compatible vendor column was found. Existing columns: ${[...names].join(", ")}`
  );
}

main()
  .catch((error) => {
    console.error("Product schema repair failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
