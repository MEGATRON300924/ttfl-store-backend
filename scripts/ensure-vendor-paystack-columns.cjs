const { PrismaClient } = require("@prisma/client");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vendor_profiles'
    `);
    const columns = new Set(rows.map((row) => row.column_name));

    if (columns.has("paystack_bank_code")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "vendor_profiles" RENAME COLUMN "paystack_bank_code" TO "paystackBankCode"`);
      console.log("Renamed vendor_profiles.paystack_bank_code to vendor_profiles.paystackBankCode.");
      return;
    }

    if (!columns.has("paystackBankCode")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "vendor_profiles" ADD COLUMN "paystackBankCode" TEXT`);
      console.log("Added vendor_profiles.paystackBankCode.");
    } else {
      console.log("vendor_profiles.paystackBankCode already exists.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Vendor Paystack column compatibility check failed:", error);
  process.exit(1);
});
