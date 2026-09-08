const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

const productStart = schema.indexOf("model Product {");
const productEnd = schema.indexOf("\n}", productStart);
if (productStart === -1 || productEnd === -1) throw new Error("Product model not found.");

const block = schema.slice(productStart, productEnd);
if (!block.includes("sponsored")) {
  // Keep the Prisma model attributes on separate lines. The previous version
  // appended directly after @@map("products"), producing invalid Prisma such as:
  // @@map("products")  sponsored Boolean @default(false)
  const insertion = '\n  sponsored     Boolean          @default(false)\n  sponsoredAt   DateTime?\n';
  schema = schema.slice(0, productEnd) + insertion + schema.slice(productEnd);
  fs.writeFileSync(schemaPath, schema);
}

// Repair schemas produced by the older buggy extension script, so a deployment
// can recover automatically even when the canonical schema is restored first.
schema = fs.readFileSync(schemaPath, "utf8").replace(
  /(@@map\("products"\))\s+sponsored\s+Boolean\s+@default\(false\)/g,
  '$1\n  sponsored     Boolean          @default(false)'
);
fs.writeFileSync(schemaPath, schema);

console.log("Sponsored products Prisma fields ensured.");
