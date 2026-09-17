const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

const start = schema.indexOf("model Category {");
if (start < 0) throw new Error("Category model not found in Prisma schema");
const end = schema.indexOf("\n}", start);
if (end < 0) throw new Error("Category model is malformed");
const block = schema.slice(start, end);

if (!/^\s*variationConfig\s+Json\?/m.test(block)) {
  const marker = schema.indexOf("  updatedAt", start);
  if (marker < 0 || marker > end) throw new Error("Category.updatedAt marker not found");
  schema = `${schema.slice(0, marker)}  variationConfig Json?\n${schema.slice(marker)}`;
  fs.writeFileSync(schemaPath, schema);
  console.log("Category variationConfig preserved in canonical Prisma schema.");
} else {
  console.log("Category variationConfig already present in canonical Prisma schema.");
}
