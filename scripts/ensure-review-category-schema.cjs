const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      ALTER TABLE reviews
        ADD COLUMN IF NOT EXISTS delivery_rating TEXT,
        ADD COLUMN IF NOT EXISTS customer_service_rating TEXT,
        ADD COLUMN IF NOT EXISTS product_quality_rating TEXT,
        ADD COLUMN IF NOT EXISTS description_accuracy_rating TEXT,
        ADD COLUMN IF NOT EXISTS value_for_money_rating TEXT
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS reviews_created_at_status_idx
      ON reviews ("createdAt", status)
    `);
    console.log("Review category columns are ready.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Review category schema check failed:", error);
  process.exitCode = 1;
});
