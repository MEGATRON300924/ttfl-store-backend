const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

function addProductField(fieldName, definition) {
  const start = schema.indexOf("model Product {");
  if (start === -1) throw new Error("Product model not found.");
  const end = schema.indexOf("\n}", start);
  if (end === -1) throw new Error("Product model is malformed.");
  const block = schema.slice(start, end);
  if (new RegExp(`\\b${fieldName}\\b`).test(block)) return;
  const marker = schema.indexOf("  createdAt", start);
  if (marker === -1 || marker > end) throw new Error(`Could not find Product.createdAt to insert ${fieldName}.`);
  schema = schema.slice(0, marker) + `  ${definition}\n` + schema.slice(marker);
}

addProductField("comingSoon", "comingSoon Boolean @default(false) @map(\"coming_soon\")");
addProductField("availableAt", "availableAt DateTime? @map(\"available_at\")");

fs.writeFileSync(schemaPath, schema);

const sql = [
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS coming_soon BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS product_availability_notifications (\n    id TEXT PRIMARY KEY,\n    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,\n    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,\n    email TEXT,\n    whatsapp TEXT,\n    email_notified_at TIMESTAMPTZ,\n    whatsapp_notified_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    CHECK (email IS NOT NULL OR whatsapp IS NOT NULL)\n  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS product_availability_notifications_product_email_idx ON product_availability_notifications(product_id, email) WHERE email IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS product_availability_notifications_product_whatsapp_idx ON product_availability_notifications(product_id, whatsapp) WHERE whatsapp IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS product_availability_notifications_product_idx ON product_availability_notifications(product_id)`,
];

const { execFileSync } = require("node:child_process");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

for (const statement of sql) {
  execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], { input: statement, stdio: ["pipe", "inherit", "inherit"] });
}

console.log("Coming-soon product fields and notification table ensured.");
