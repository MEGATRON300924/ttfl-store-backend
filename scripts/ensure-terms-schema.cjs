const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS terms_accepted_version TEXT,
        ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS terms_accepted_ip TEXT
    `);
    console.log("Terms acceptance columns are ready.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Terms schema check failed:", error);
  process.exitCode = 1;
});
