const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

const modelStart = schema.indexOf("model FlashDeal {");

if (modelStart === -1) {
  schema += `\n\nmodel FlashDeal {\n  id              String   @id\n  vendorId        String   @map("vendor_id")\n  productId       String   @map("product_id")\n  discountPercent Decimal  @map("discount_percent") @db.Decimal(5, 2)\n  salePrice       Decimal  @map("sale_price") @db.Decimal(12, 2)\n  startsAt        DateTime @map("starts_at")\n  endsAt          DateTime @map("ends_at")\n  active          Boolean  @default(true)\n  quantityCap     Int?     @map("quantity_cap")\n  soldCount       Int      @default(0) @map("sold_count")\n  paused          Boolean  @default(false)\n  createdAt       DateTime @default(now()) @map("created_at")\n  updatedAt       DateTime @updatedAt @map("updated_at")\n\n  @@index([vendorId, active, startsAt, endsAt])\n  @@index([productId, active, startsAt, endsAt])\n  @@index([active, startsAt, endsAt], map: "flash_deals_active_idx")\n  @@map("flash_deals")\n}\n`;
} else {
  const modelEnd = schema.indexOf("\n}", modelStart);
  if (modelEnd === -1) throw new Error("FlashDeal model has an invalid closing brace.");

  let block = schema.slice(modelStart, modelEnd);
  const fields = [
    '  quantityCap     Int?     @map("quantity_cap")',
    '  soldCount       Int      @default(0) @map("sold_count")',
    '  paused          Boolean  @default(false)',
  ];

  for (const field of fields) {
    const fieldName = field.trim().split(/\s+/)[0];
    if (!new RegExp(`^\\s*${fieldName}\\s+`, "m").test(block)) {
      const insertAt = block.lastIndexOf("\n  createdAt");
      if (insertAt === -1) throw new Error(`Could not find insertion point for ${fieldName}.`);
      block = block.slice(0, insertAt) + `\n${field}` + block.slice(insertAt);
    }
  }

  schema = schema.slice(0, modelStart) + block + schema.slice(modelEnd);
}

fs.writeFileSync(schemaPath, schema);
console.log("Flash deals Prisma model ensured.");
