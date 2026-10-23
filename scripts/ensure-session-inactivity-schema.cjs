const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  // Additive-only schema update. This does not modify or remove existing sessions.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "sessions"
    ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  console.log("Session inactivity timestamp is present; existing sessions were preserved.");
}

main()
  .catch((error) => {
    console.error("Session inactivity schema check failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
