const { PrismaClient } = require("@prisma/client");

const TABLES = [
  { table: "payments", canonical: "order_id", legacyNames: ["orderId", "orderid"] },
  { table: "coupon_redemptions", canonical: "order_id", legacyNames: ["orderId", "orderid"] },
];

function quoteIdentifier(value) {
  return '"' + value.replace(/"/g, '""') + '"';
}

async function getColumns(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `,
    table
  );
  return new Set(rows.map((row) => row.column_name));
}

async function ensureColumn(prisma, table, canonical, legacyNames) {
  let columns = await getColumns(prisma, table);

  if (columns.has(canonical)) {
    console.log(`[schema] ${table}.${canonical}: OK`);
    return;
  }

  for (const legacy of legacyNames) {
    if (!columns.has(legacy)) continue;

    // Run exactly one DDL statement per Prisma call. Neon/PostgreSQL prepared
    // statements reject batches containing multiple commands.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${quoteIdentifier(table)} RENAME COLUMN ${quoteIdentifier(legacy)} TO ${quoteIdentifier(canonical)}`
    );

    columns = await getColumns(prisma, table);
    if (!columns.has(canonical)) {
      throw new Error(`Renamed ${table}.${legacy}, but ${table}.${canonical} is still missing.`);
    }

    console.log(`[schema] ${table}.${legacy} -> ${table}.${canonical}: REPAIRED`);
    return;
  }

  throw new Error(
    `${table}.${canonical} is missing and no compatible legacy column was found. Existing columns: ${[...columns].join(", ") || "(none)"}`
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const prisma = new PrismaClient();
  try {
    for (const item of TABLES) {
      await ensureColumn(prisma, item.table, item.canonical, item.legacyNames);
    }
    console.log("[schema] Payment/order reference compatibility: COMPLETE");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Order-reference column compatibility check failed:", error);
  process.exit(1);
});
