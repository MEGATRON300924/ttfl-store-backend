const { execFileSync } = require("node:child_process");
const path = require("node:path");
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const sql = [
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_access_token_hash TEXT;",
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_access_expires_at TIMESTAMPTZ;",
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_latitude DOUBLE PRECISION;",
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_longitude DOUBLE PRECISION;",
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_accuracy DOUBLE PRECISION;",
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_heading DOUBLE PRECISION;",
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_speed DOUBLE PRECISION;",
  "ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS driver_location_updated_at TIMESTAMPTZ;",
  "CREATE INDEX IF NOT EXISTS vendor_orders_driver_access_token_hash_idx ON vendor_orders(driver_access_token_hash);",
].join("\n");
execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
console.log("TTFL rider live-location columns are ready.");
