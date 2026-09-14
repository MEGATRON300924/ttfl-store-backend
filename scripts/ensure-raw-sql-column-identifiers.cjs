const fs = require("node:fs");
const path = require("node:path");

// PostgreSQL column names for the legacy marketplace tables are snake_case.
// The Prisma schema maps these database columns to camelCase model fields.
// Keep raw SQL aligned with the actual database identifiers and never rewrite
// normal TypeScript property access such as product.vendorId.
const replacements = [
  [/p\.\"vendorId\"/g, "p.vendor_id"],
  [/oi\.\"productId\"/g, "oi.product_id"],
  [/oi\.\"vendorOrderId\"/g, "oi.vendor_order_id"],
  [/vo\.\"orderId\"/g, "vo.order_id"],
  [/o\.\"paymentStatus\"/g, "o.payment_status"],
];

const files = [
  "src/modules/orders/orders.service.ts",
  "src/modules/flash-deals/flash-deals.service.ts",
  "src/modules/products/products.service.ts",
];

for (const relativePath of files) {
  const filePath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(filePath)) continue;
  let source = fs.readFileSync(filePath, "utf8");
  const before = source;
  for (const [pattern, replacement] of replacements) source = source.replace(pattern, replacement);
  if (source !== before) fs.writeFileSync(filePath, source);
}

console.log("Raw SQL PostgreSQL column identifiers ensured.");
