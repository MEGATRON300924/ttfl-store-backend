const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

const actions = [
  "VENDOR_STAFF_INVITED",
  "VENDOR_STAFF_UPDATED",
  "VENDOR_STAFF_REMOVED",
  "VENDOR_STAFF_ACCEPTED",
  "ADMIN_FLASH_DEAL_CREATED",
  "ADMIN_FLASH_DEAL_CANCELLED",
  "ADMIN_FEATURED_PRODUCT_CREATED",
  "ADMIN_FEATURED_STORE_CREATED",
  "PRODUCT_AVAILABILITY_NOTIFIED",
];

const enumStart = schema.indexOf("enum AuditAction {");
if (enumStart === -1) throw new Error("AuditAction enum not found in prisma/schema.prisma");
const enumEnd = schema.indexOf("\n}", enumStart);
if (enumEnd === -1) throw new Error("AuditAction enum is malformed");
const enumBlock = schema.slice(enumStart, enumEnd);
const missing = actions.filter((action) => !new RegExp(`^\\s*${action}\\s*$`, "m").test(enumBlock));
if (missing.length > 0) schema = schema.slice(0, enumEnd) + "\n" + missing.map((action) => `  ${action}`).join("\n") + schema.slice(enumEnd);
fs.writeFileSync(schemaPath, schema);
console.log("Prisma audit actions prepared.");
