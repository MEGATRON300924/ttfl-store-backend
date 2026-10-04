const { PrismaClient } = require("@prisma/client");

async function renameIfNeeded(prisma, table, canonical, legacyNames) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, table);
  const columns = new Set(rows.map((row) => row.column_name));
  if (columns.has(canonical)) {
    console.log(`${table}.${canonical} already exists.`);
    return;
  }
  for (const legacy of legacyNames) {
    if (columns.has(legacy)) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" RENAME COLUMN "${legacy}" TO "${canonical}"`
      );
      console.log(`Renamed ${table}.${legacy} to ${table}.${canonical}.`);
      return;
    }
  }
  throw new Error(
    `${table}.${canonical} is missing and no compatible legacy column was found. Existing columns: ${[...columns].join(", ")}`
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient();
  try {
    await renameIfNeeded(prisma, "product_images", "product_id", ["productId", "productid"]);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Product image schema compatibility check failed:", error);
  process.exit(1);
});
