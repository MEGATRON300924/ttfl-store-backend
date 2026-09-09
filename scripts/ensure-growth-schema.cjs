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

addModel(`model ProductPriceHistory {
 id String @id
 productId String @map("product_id")
 oldPrice Decimal? @map("old_price")
 newPrice Decimal @map("new_price")
 changedAt DateTime @default(now()) @map("changed_at")
 @@index([productId,changedAt(sort: Desc)], name:"product_price_history_product_idx")
 @@map("product_price_history")
}`);

addModel(`model MaxEventOutbox {
 id String @id
 event String
 payload Json
 status String @default("PENDING")
 attempts Int @default(0)
 lastError String? @map("last_error")
 availableAt DateTime @default(now()) @map("available_at")
 sentAt DateTime? @map("sent_at")
 createdAt DateTime @default(now()) @map("created_at")
 @@index([status,availableAt])
 @@map("max_event_outbox")
}`);

addModel(`model VendorNotificationPreference {
 id String @id
 vendorId String @unique @map("vendor_id")
 emailEnabled Boolean @default(true) @map("email_enabled")
 whatsappEnabled Boolean @default(true) @map("whatsapp_enabled")
 marketingEnabled Boolean @default(false) @map("marketing_enabled")
 updatedAt DateTime @updatedAt @map("updated_at")
 @@map("vendor_notification_preferences")
}`);

addModel(`model ProductAlert {
 id String @id
 productId String @map("product_id")
 userId String? @map("user_id")
 email String?
 whatsapp String?
 type String
 targetPrice Decimal? @map("target_price")
 notifiedAt DateTime? @map("notified_at")
 createdAt DateTime @default(now()) @map("created_at")
 @@index([productId,type,notifiedAt])
 @@map("product_alerts")
}`);

addModel(`model PromotionEvent {
 id String @id
 promotionType String @map("promotion_type")
 promotionId String @map("promotion_id")
 vendorId String @map("vendor_id")
 productId String? @map("product_id")
 event String
 sessionId String? @map("session_id")
 userId String? @map("user_id")
 quantity Int?
 revenue Decimal?
 source String?
 createdAt DateTime @default(now()) @map("created_at")
 @@index([vendorId,createdAt(sort: Desc)], name:"promotion_events_vendor_idx")
 @@index([promotionType,promotionId,event], name:"promotion_events_promotion_created_idx")
 @@map("promotion_events")
}`);

const prismaBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma",
);

const sql = `
CREATE TABLE IF NOT EXISTS product_price_history(
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 old_price NUMERIC,
 new_price NUMERIC NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS product_price_history_product_idx
 ON product_price_history(product_id,changed_at DESC);

CREATE TABLE IF NOT EXISTS max_event_outbox(
 id TEXT PRIMARY KEY,
 event TEXT NOT NULL,
 payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING',
 attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 sent_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS max_event_outbox_pending_idx
 ON max_event_outbox(status,available_at);

CREATE TABLE IF NOT EXISTS vendor_notification_preferences(
 id TEXT PRIMARY KEY,
 vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_profiles(id) ON DELETE CASCADE,
 email_enabled BOOLEAN NOT NULL DEFAULT true,
 whatsapp_enabled BOOLEAN NOT NULL DEFAULT true,
 marketing_enabled BOOLEAN NOT NULL DEFAULT false,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_alerts(
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 email TEXT,
 whatsapp TEXT,
 type TEXT NOT NULL,
 target_price NUMERIC,
 notified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS product_alerts_lookup_idx
 ON product_alerts(product_id,type,notified_at);

CREATE TABLE IF NOT EXISTS promotion_events(
 id TEXT PRIMARY KEY,
 promotion_type TEXT NOT NULL,
 promotion_id TEXT NOT NULL,
 vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
 product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
 event TEXT NOT NULL,
 session_id TEXT,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 quantity INTEGER,
 revenue NUMERIC,
 source TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "promotion_events_vendor_idx"
 ON promotion_events(vendor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS "promotion_events_promotion_created_idx"
 ON promotion_events(promotion_type,promotion_id,event);

CREATE OR REPLACE FUNCTION ttfl_record_product_price_change()
RETURNS trigger AS $$
BEGIN
 IF NEW.price IS DISTINCT FROM OLD.price THEN
  INSERT INTO product_price_history(id,product_id,old_price,new_price)
  VALUES(md5(random()::text||clock_timestamp()::text||NEW.id),NEW.id,OLD.price,NEW.price);
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ttfl_product_price_history_trigger ON products;
CREATE TRIGGER ttfl_product_price_history_trigger
AFTER UPDATE OF price ON products
FOR EACH ROW EXECUTE FUNCTION ttfl_record_product_price_change();
`;

function prismaField(column) {
  const map = {
    promotion_type: "promotionType",
    promotion_id: "promotionId",
    vendor_id: "vendorId",
    product_id: "productId",
    session_id: "sessionId",
    user_id: "userId",
    created_at: "createdAt",
    event: "event",
    quantity: "quantity",
    revenue: "revenue",
    source: "source",
  };
  return map[column] || null;
}

function indexAttributeFromDefinition(indexName, indexDef) {
  const match = indexDef.match(/USING\s+btree\s+\((.+)\)$/i);
  if (!match) return null;

  const parts = match[1]
    .split(",")
    .map((part) => part.trim())
    .map((part) => {
      const columnMatch = part.match(/^"?([a-zA-Z0-9_]+)"?(?:\s+(ASC|DESC))?$/i);
      if (!columnMatch) return null;
      const field = prismaField(columnMatch[1]);
      if (!field) return null;
      const sort = columnMatch[2]?.toUpperCase();
      return sort === "DESC" ? `${field}(sort: Desc)` : field;
    });

  if (parts.some((part) => !part)) return null;
  return `@@index([${parts.join(",")}], name:"${indexName}")`;
}

async function reconcileExistingPromotionIndexes() {
  if (!process.env.DATABASE_URL) return;

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT indexname,indexdef
      FROM pg_indexes
      WHERE schemaname='public' AND tablename='promotion_events'
        AND indexname LIKE 'promotion_events_%'
      ORDER BY indexname
    `);

    const attributes = rows
      .map((row) => indexAttributeFromDefinition(String(row.indexname), String(row.indexdef)))
      .filter(Boolean);

    if (attributes.length) {
      const modelStart = schema.indexOf("model PromotionEvent {");
      const modelEnd = modelStart >= 0 ? schema.indexOf("\n}", modelStart) : -1;

      if (modelStart >= 0 && modelEnd >= 0) {
        const model = schema.slice(modelStart, modelEnd);
        const withoutIndexes = model
          .split("\n")
          .filter((line) => !line.trim().startsWith("@@index("))
          .join("\n");
        const rebuilt = `${withoutIndexes}\n ${attributes.join("\n ")}`;
        schema = `${schema.slice(0, modelStart)}${rebuilt}${schema.slice(modelEnd)}`;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  execFileSync(
    prismaBin,
    ["db", "execute", "--stdin", "--schema", schemaPath],
    { input: sql, stdio: ["pipe", "inherit", "inherit"] },
  );

  await reconcileExistingPromotionIndexes();
  fs.writeFileSync(schemaPath, schema);

  console.log(
    "Growth, price-history, MAX outbox, alert, promotion analytics and price trigger schema ensured.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
