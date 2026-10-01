const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('ALTER TABLE addresses ADD COLUMN IF NOT EXISTS digital_postcode TEXT');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_postcode TEXT');
    console.log("Digital postcode columns are ready.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Digital postcode schema check failed:", error);
  process.exitCode = 1;
});
