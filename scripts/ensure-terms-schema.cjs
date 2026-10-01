const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS terms_accepted_version TEXT,
        ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS terms_accepted_ip TEXT
    `);
    console.log("Terms acceptance columns are ready.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Terms schema check failed:", error);
  process.exitCode = 1;
});
