const fs = require("node:fs");
const path = require("node:path");

// Raw SQL must use the real PostgreSQL column names. Prisma exposes many of
// these columns as camelCase fields, but the database stores them in snake_case.
// These replacements intentionally require a table alias so normal TypeScript
// property access such as product.vendorId is never touched.
const replacements = [
  [/p\.\"vendorId\"/g, "p.vendor_id"],
  [/p\.\"deletedAt\"/g, "p.deleted_at"],
  [/p\.\"comingSoon\"/g, "p.coming_soon"],
  [/p\.\"sponsoredAt\"/g, "p.sponsored_at"],

  [/vs\.\"vendorId\"/g, "vs.vendor_id"],
  [/vs\.\"planId\"/g, "vs.plan_id"],
  [/vs\.\"renewalDate\"/g, "vs.renewal_date"],
  [/vs\.\"createdAt\"/g, "vs.created_at"],
  [/vs\.\"updatedAt\"/g, "vs.updated_at"],

  [/v\.\"storeName\"/g, "v.store_name"],
  [/v\.\"storeSlug\"/g, "v.store_slug"],
  [/v\.\"createdAt\"/g, "v.created_at"],
  [/v\.\"updatedAt\"/g, "v.updated_at"],

  [/oi\.\"productId\"/g, "oi.product_id"],
  [/oi\.\"vendorOrderId\"/g, "oi.vendor_order_id"],
  [/oi\.\"productName\"/g, "oi.product_name"],
  [/oi\.\"unitPrice\"/g, "oi.unit_price"],
  [/oi\.\"lineTotal\"/g, "oi.line_total"],
  [/oi\.\"createdAt\"/g, "oi.created_at"],

  [/vo\.\"orderId\"/g, "vo.order_id"],
  [/vo\.\"vendorId\"/g, "vo.vendor_id"],
  [/vo\.\"createdAt\"/g, "vo.created_at"],
  [/vo\.\"updatedAt\"/g, "vo.updated_at"],

  [/o\.\"paymentStatus\"/g, "o.payment_status"],
  [/o\.\"createdAt\"/g, "o.created_at"],
  [/o\.\"updatedAt\"/g, "o.updated_at"],

  [/fd\.\"productId\"/g, "fd.product_id"],
  [/fd\.\"vendorId\"/g, "fd.vendor_id"],
  [/fd\.\"discountPercent\"/g, "fd.discount_percent"],
  [/fd\.\"salePrice\"/g, "fd.sale_price"],
  [/fd\.\"startsAt\"/g, "fd.starts_at"],
  [/fd\.\"endsAt\"/g, "fd.ends_at"],
  [/fd\.\"quantityCap\"/g, "fd.quantity_cap"],
  [/fd\.\"soldCount\"/g, "fd.sold_count"],
  [/fd\.\"createdAt\"/g, "fd.created_at"],
  [/fd\.\"updatedAt\"/g, "fd.updated_at"],
];

const roots = [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")];
const extensions = new Set([".ts", ".tsx", ".js", ".cjs"]);

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }
    if (!extensions.has(path.extname(entry.name))) continue;

    let source = fs.readFileSync(filePath, "utf8");
    const before = source;
    for (const [pattern, replacement] of replacements) {
      source = source.replace(pattern, replacement);
    }
    if (source !== before) fs.writeFileSync(filePath, source);
  }
}

for (const root of roots) walk(root);
console.log("All known legacy raw SQL PostgreSQL identifiers normalized.");
