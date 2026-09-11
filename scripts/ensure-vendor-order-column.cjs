const { PrismaClient } = require("@prisma/client");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'vendor_orders'
    `);

    const columns = new Set(rows.map((row) => row.column_name));

    if (columns.has("order_id")) {
      console.log("vendor_orders.order_id already exists.");
      return;
    }

    if (columns.has("orderId")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "vendor_orders" RENAME COLUMN "orderId" TO "order_id"`);
      console.log("Renamed vendor_orders.orderId to vendor_orders.order_id.");
      return;
    }

    if (columns.has("orderid")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "vendor_orders" RENAME COLUMN "orderid" TO "order_id"`);
      console.log("Renamed vendor_orders.orderid to vendor_orders.order_id.");
      return;
    }

    throw new Error(
      `vendor_orders.order_id is missing and no compatible legacy order column was found. Existing columns: ${[...columns].join(", ")}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Vendor-order column compatibility check failed:", error);
  process.exit(1);
});
