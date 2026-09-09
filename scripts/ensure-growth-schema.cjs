const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

function addModel(model) {
  const name = model.match(/model\s+(\w+)\s*\{/)[1];
  if (schema.includes(`model ${name} {`)) return;
  schema += `\n${model}\n`;
}

addModel(`model ProductPriceHistory {\n  id String @id\n  productId String @map("product_id")\n  oldPrice Decimal? @map("old_price")\n  newPrice Decimal @map("new_price")\n  changedAt DateTime @default(now()) @map("changed_at")\n  @@index([productId, changedAt])\n  @@map("product_price_history")\n}`);
addModel(`model MaxEventOutbox {\n  id String @id\n  event String\n  payload Json\n  status String @default("PENDING")\n  attempts Int @default(0)\n  lastError String? @map("last_error")\n  availableAt DateTime @default(now()) @map("available_at")\n  sentAt DateTime? @map("sent_at")\n  createdAt DateTime @default(now()) @map("created_at")\n  @@index([status, availableAt])\n  @@map("max_event_outbox")\n}`);

fs.writeFileSync(schemaPath, schema);
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
for (const sql of [
  `CREATE TABLE IF NOT EXISTS product_price_history (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, old_price NUMERIC, new_price NUMERIC NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS product_price_history_product_idx ON product_price_history(product_id, changed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS max_event_outbox (id TEXT PRIMARY KEY, event TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS max_event_outbox_pending_idx ON max_event_outbox(status, available_at)`,
]) execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
console.log("Growth, price-history and MAX outbox schema ensured.");
