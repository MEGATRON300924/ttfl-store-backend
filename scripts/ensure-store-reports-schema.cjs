const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS store_reports (
      id text PRIMARY KEY,
      reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vendor_id text NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
      reason text NOT NULL,
      description text NOT NULL,
      evidence_links text[] NOT NULL DEFAULT ARRAY[]::text[],
      order_number text,
      status text NOT NULL DEFAULT 'OPEN',
      admin_notes text,
      resolved_at timestamptz,
      resolved_by_id text,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS store_reports_vendor_status_idx ON store_reports(vendor_id,status)');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS store_reports_reporter_created_idx ON store_reports(reporter_id,created_at)');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS store_reports_status_created_idx ON store_reports(status,created_at)');
    console.log("store_reports table is ready.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("store_reports schema check failed:", error);
  process.exitCode = 1;
});
