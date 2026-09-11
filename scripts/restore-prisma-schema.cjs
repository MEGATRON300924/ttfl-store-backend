const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const sourceUrl = "https://raw.githubusercontent.com/MEGATRON300924/ttfl-store-backend/756491e9fd5c12c24e611509626ced3c8b818365/prisma/schema.prisma";

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Schema source returned HTTP ${response.statusCode}`));
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

function normalizeProductVendorColumn(schema) {
  const start = schema.indexOf("model Product {");
  if (start === -1) throw new Error("Downloaded Prisma schema is missing model Product.");
  const end = schema.indexOf("\n}", start);
  if (end === -1) throw new Error("Downloaded Prisma schema has an invalid Product model.");
  const block = schema.slice(start, end);
  const normalized = block
    .replace(/  vendorId\s+String\s*\n/, '  vendorId      String           @map("vendor_id")\n')
    .replace(/  vendor\s+VendorProfile\s+@relation\(fields: \[vendorId\], references: \[id\], onDelete: Cascade\)\n/, '  vendor        VendorProfile    @relation(fields: [vendorId], references: [id], onDelete: Cascade)\n');
  if (!normalized.includes('vendorId      String           @map("vendor_id")')) {
    throw new Error("Product vendorId field could not be normalized.");
  }
  return schema.slice(0, start) + normalized + schema.slice(end);
}

function normalizeOrderItemVendorColumn(schema) {
  const start = schema.indexOf("model OrderItem {");
  if (start === -1) throw new Error("Downloaded Prisma schema is missing model OrderItem.");
  const end = schema.indexOf("\n}", start);
  if (end === -1) throw new Error("Downloaded Prisma schema has an invalid OrderItem model.");

  const block = schema.slice(start, end);
  const normalized = block.replace(
    /  vendorOrderId\s+String\s*\n/,
    '  vendorOrderId String       @map("vendor_order_id")\n'
  );

  if (!normalized.includes('vendorOrderId String       @map("vendor_order_id")')) {
    throw new Error("OrderItem vendorOrderId field could not be normalized.");
  }

  return schema.slice(0, start) + normalized + schema.slice(end);
}

function normalizeVendorOrderColumn(schema) {
  const start = schema.indexOf("model VendorOrder {");
  if (start === -1) throw new Error("Downloaded Prisma schema is missing model VendorOrder.");
  const end = schema.indexOf("\n}", start);
  if (end === -1) throw new Error("Downloaded Prisma schema has an invalid VendorOrder model.");

  const block = schema.slice(start, end);
  const normalized = block.replace(
    /  orderId\s+String\s*\n/,
    '  orderId String @map("order_id")\n'
  );

  if (!normalized.includes('orderId String @map("order_id")')) {
    throw new Error("VendorOrder orderId field could not be normalized.");
  }

  return schema.slice(0, start) + normalized + schema.slice(end);
}

(async () => {
  let schema = await download(sourceUrl);

  if (!["model User {", "model Order {", "model VendorProfile {", "model Product {", "model OrderItem {", "model VendorOrder {"]
    .every(x => schema.includes(x))) {
    throw new Error("Downloaded Prisma schema failed validation.");
  }

  schema = normalizeProductVendorColumn(schema);
  schema = normalizeOrderItemVendorColumn(schema);
  schema = normalizeVendorOrderColumn(schema);

  fs.writeFileSync(schemaPath, schema);

  for (const script of [
    "ensure-affiliate-prisma-schema.cjs",
    "ensure-tracking-schema.cjs",
    "ensure-vendor-staff-schema.cjs",
    "ensure-audit-actions.cjs",
    "ensure-flash-deals-schema.cjs",
    "ensure-sponsored-products-schema.cjs",
    "ensure-store-badges.cjs",
    "ensure-coming-soon-schema.cjs",
    "ensure-growth-schema.cjs",
    "ensure-promotion-events-schema.cjs",
    "ensure-launch-campaign-schema.cjs",
  ]) {
    execFileSync(process.execPath, [path.join(process.cwd(), "scripts", script)], { stdio: "inherit" });
  }

  console.log("Canonical Prisma schema restored with mapped product, vendor-order, and order-item foreign-key columns plus all local schema extensions applied.");
})().catch(error => {
  console.error("Prisma schema restoration failed:", error);
  process.exit(1);
});
