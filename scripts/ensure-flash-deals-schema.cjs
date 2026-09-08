const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

if (!schema.includes("model FlashDeal {")) {
  schema += `\n\nmodel FlashDeal {\n  id              String   @id\n  vendorId        String   @map("vendor_id")\n  productId       String   @map("product_id")\n  discountPercent Decimal  @map("discount_percent") @db.Decimal(5, 2)\n  salePrice       Decimal  @map("sale_price") @db.Decimal(12, 2)\n  startsAt        DateTime @map("starts_at")\n  endsAt          DateTime @map("ends_at")\n  active          Boolean  @default(true)\n  createdAt       DateTime @default(now()) @map("created_at")\n  updatedAt       DateTime @updatedAt @map("updated_at")\n\n  @@index([vendorId, active, startsAt, endsAt])\n  @@index([productId, active, startsAt, endsAt])\n  @@index([active, startsAt, endsAt], map: "flash_deals_active_idx")\n  @@map("flash_deals")\n}\n`;
  fs.writeFileSync(schemaPath, schema);
}

console.log("Flash deals Prisma model ensured.");
