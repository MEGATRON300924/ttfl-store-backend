const { Client } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_items'
    `);

    const columns = new Set(result.rows.map((row) => row.column_name));

    if (columns.has("vendor_order_id")) {
      console.log("order_items.vendor_order_id already exists.");
      return;
    }

    if (columns.has("vendorOrderId")) {
      await client.query(`ALTER TABLE "order_items" RENAME COLUMN "vendorOrderId" TO "vendor_order_id"`);
      console.log("Renamed order_items.vendorOrderId to order_items.vendor_order_id.");
      return;
    }

    if (columns.has("vendororderid")) {
      await client.query(`ALTER TABLE "order_items" RENAME COLUMN "vendororderid" TO "vendor_order_id"`);
      console.log("Renamed order_items.vendororderid to order_items.vendor_order_id.");
      return;
    }

    throw new Error(
      `order_items.vendor_order_id is missing and no compatible legacy vendor-order column was found. Existing columns: ${[...columns].join(", ")}`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Order-item vendor column compatibility check failed:", error);
  process.exit(1);
});
