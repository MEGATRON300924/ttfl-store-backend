const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");

if (/model\s+VendorStoreCategory\s*\{/m.test(schema)) {
  console.log("Vendor store category Prisma model already present.");
  process.exit(0);
}

const model = `\n\n// Compatibility model for the vendor store category table maintained by the application.\nmodel VendorStoreCategory {\n  vendorId    String   @id @map("vendor_id")\n  categorySlug String  @map("category_slug")\n  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)\n  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)\n\n  @@index([categorySlug], map: "vendor_store_categories_slug_idx")\n  @@map("vendor_store_categories")\n}\n`;

fs.writeFileSync(schemaPath, `${schema.trimEnd()}${model}`);
console.log("Vendor store category Prisma model ensured without changing existing table data.");
