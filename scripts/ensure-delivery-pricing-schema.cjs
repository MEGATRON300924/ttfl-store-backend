const { execFileSync } = require("node:child_process");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

const sql = [
  'ALTER TYPE "CouponType" ADD VALUE IF NOT EXISTS \'FREE_SHIPPING\';',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveryAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;',
].join("\n");

execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});
console.log("Delivery pricing and free-shipping schema are ready.");
