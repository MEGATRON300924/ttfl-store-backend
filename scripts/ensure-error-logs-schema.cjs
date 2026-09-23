const { execFileSync } = require("node:child_process");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

const sql = `
CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY,
  reference_code TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL DEFAULT 'ERROR',
  http_status INTEGER NOT NULL DEFAULT 500,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  explanation TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  order_number TEXT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT,
  vendor_id TEXT REFERENCES vendor_profiles(id) ON DELETE SET NULL,
  vendor_name TEXT,
  metadata JSONB,
  stack TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS error_logs_reference_code_idx ON error_logs(reference_code);
CREATE INDEX IF NOT EXISTS error_logs_error_code_idx ON error_logs(error_code);
CREATE INDEX IF NOT EXISTS error_logs_order_number_idx ON error_logs(order_number);
CREATE INDEX IF NOT EXISTS error_logs_product_id_idx ON error_logs(product_id);
CREATE INDEX IF NOT EXISTS error_logs_user_id_idx ON error_logs(user_id);
CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs(created_at);
`;

execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});
console.log("TTFL error log table ensured.");
