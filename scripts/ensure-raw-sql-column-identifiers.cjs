const fs = require("node:fs");
const path = require("node:path");

const replacements = [
  [/oi\.product_id/g, 'oi."productId"'],
  [/oi\.vendor_order_id/g, 'oi."vendorOrderId"'],
  [/vo\.order_id/g, 'vo."orderId"'],
  [/o\.payment_status/g, 'o."paymentStatus"'],
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
