const { execFileSync } = require("node:child_process");
const path = require("node:path");
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const sql = [
  "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude DOUBLE PRECISION;",
  "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION;",
  "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_coordinates_pair_check' AND conrelid = 'orders'::regclass) THEN ALTER TABLE orders ADD CONSTRAINT orders_delivery_coordinates_pair_check CHECK ((delivery_latitude IS NULL) = (delivery_longitude IS NULL)); END IF; END $$;",
].join("\n");
execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
console.log("Foods delivery coordinate columns are ready.");
