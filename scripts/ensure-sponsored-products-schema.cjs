const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

const productStart = schema.indexOf("model Product {");
const productEnd = schema.indexOf("\n}", productStart);
if (productStart === -1 || productEnd === -1) throw new Error("Product model not found.");

const block = schema.slice(productStart, productEnd);
if (!block.includes("sponsored")) {
  schema = schema.slice(0, productEnd) + '  sponsored     Boolean          @default(false)\n  sponsoredAt   DateTime?\n' + schema.slice(productEnd);
  fs.writeFileSync(schemaPath, schema);
}

console.log("Sponsored products Prisma fields ensured.");
