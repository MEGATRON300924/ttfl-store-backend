const { PrismaClient } = require("@prisma/client");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_items'
    `);
    const columns = new Set(rows.map((row) => row.column_name));
    if (!columns.has("variantKey")) await prisma.$executeRawUnsafe(`ALTER TABLE "order_items" ADD COLUMN "variantKey" TEXT`);
    if (!columns.has("variantLabel")) await prisma.$executeRawUnsafe(`ALTER TABLE "order_items" ADD COLUMN "variantLabel" TEXT`);
    if (!columns.has("variantOptions")) await prisma.$executeRawUnsafe(`ALTER TABLE "order_items" ADD COLUMN "variantOptions" JSONB`);
    console.log("order_items variation columns are ready.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Order-item variation column compatibility check failed:", error);
  process.exit(1);
});
