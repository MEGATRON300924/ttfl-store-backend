const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

function ensureOrderItemField(field) {
  const modelStart = schema.indexOf("model OrderItem {");
  if (modelStart < 0) throw new Error("OrderItem model not found in Prisma schema");
  const modelEnd = schema.indexOf("\n}", modelStart);
  if (modelEnd < 0) throw new Error("OrderItem model is malformed");

  const fieldName = field.trim().split(/\s+/)[0];
  const modelBlock = schema.slice(modelStart, modelEnd);
  if (new RegExp(`^\\s*${fieldName}\\s+`, "m").test(modelBlock)) return false;

  // Insert immediately before the first model index/attribute. This is more
  // robust than depending on a particular createdAt line being present.
  const attributeMatch = modelBlock.match(/^\s*@@(?:index|unique|map)/m);
  let insertAt = attributeMatch?.index != null
    ? modelStart + attributeMatch.index
    : modelEnd;

  schema = `${schema.slice(0, insertAt)}  ${field}\n${schema.slice(insertAt)}`;
  return true;
}

const added = [
  ensureOrderItemField("variantKey String?"),
  ensureOrderItemField("variantLabel String?"),
  ensureOrderItemField("variantOptions Json?"),
].filter(Boolean).length;

if (added > 0) {
  fs.writeFileSync(schemaPath, schema);
  console.log(`Prisma OrderItem variation fields ensured in canonical schema (${added} added).`);
} else {
  console.log("Prisma OrderItem variation fields already exist in canonical schema.");
}
