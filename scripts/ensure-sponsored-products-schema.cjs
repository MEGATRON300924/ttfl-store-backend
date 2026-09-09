const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

function productBounds(value) {
  const start = value.indexOf("model Product {");
  const end = value.indexOf("\n}", start);
  if (start === -1 || end === -1) throw new Error("Product model not found.");
  return { start, end };
}

let { start, end } = productBounds(schema);
let block = schema.slice(start, end);

// Always repair/retain both sponsored fields in the Product model. Do not
// re-read schema.prisma after inserting them: that used to discard the edit
// and made Prisma think the existing sponsored columns should be dropped.
if (!/\n\s*sponsored\s+Boolean\s+@default\(false\)/.test(block)) {
  schema = schema.slice(0, end) +
    '\n  sponsored     Boolean          @default(false)\n  sponsoredAt   DateTime?\n' +
    schema.slice(end);
}

({ start, end } = productBounds(schema));
block = schema.slice(start, end);

if (!/\n\s*tags\s+String\[\]\s+@default\(\[\]\)/.test(block)) {
  schema = schema.slice(0, end) +
    '\n  tags           String[]         @default([])\n' +
    schema.slice(end);
}

// Repair the malformed form produced by the previous script version.
schema = schema.replace(
  /(@@map\("products"\))\s+sponsored\s+Boolean\s+@default\(false)/g,
  '$1\n  sponsored     Boolean          @default(false)'
);

fs.writeFileSync(schemaPath, schema);

const validatorsPath = path.join(process.cwd(), "src", "modules", "products", "products.validators.ts");
if (fs.existsSync(validatorsPath)) {
  let validators = fs.readFileSync(validatorsPath, "utf8");
  if (!validators.includes("tags: z.array(z.string().min(1).max(40)).max(20)")) {
    validators = validators.replace(
      '  location: optionalString(z.string().max(120)),\n',
      '  location: optionalString(z.string().max(120)),\n  tags: z.array(z.string().min(1).max(40)).max(20).default([]),\n'
    );
  }
  if (!validators.match(/updateProductSchema[\s\S]*tags:/)) {
    validators = validators.replace(
      '  location: optionalString(z.string().max(120)),\n  images: baseProductFields.images.optional(),',
      '  location: optionalString(z.string().max(120)),\n  tags: z.array(z.string().min(1).max(40)).max(20).optional(),\n  images: baseProductFields.images.optional(),'
    );
  }
  fs.writeFileSync(validatorsPath, validators);
}

const servicePath = path.join(process.cwd(), "src", "modules", "products", "products.service.ts");
if (fs.existsSync(servicePath)) {
  let service = fs.readFileSync(servicePath, "utf8");
  service = service.replace(
    'specifications: input.specifications, estimatedDeliveryDays: input.estimatedDeliveryDays, publicProductId,',
    'specifications: input.specifications, tags: input.tags ?? [], estimatedDeliveryDays: input.estimatedDeliveryDays, publicProductId,'
  );
  service = service.replace(
    'specifications: input.specifications, estimatedDeliveryDays: input.estimatedDeliveryDays, status: input.status,',
    'specifications: input.specifications, tags: input.tags, estimatedDeliveryDays: input.estimatedDeliveryDays, status: input.status,'
  );
  service = service.replace(
    'function parseNaturalSearch(query?: string) {',
    'function normalizeSearchToken(token: string) { const value = token.toLowerCase().trim(); if (value.length > 4 && value.endsWith("ies")) return `${value.slice(0, -3)}y`; if (value.length > 4 && value.endsWith("es")) return value.slice(0, -2); if (value.length > 3 && value.endsWith("s")) return value.slice(0, -1); return value; }\nfunction parseNaturalSearch(query?: string) {'
  );
  service = service.replace(
    'const tokens = Array.from(new Set(parsed.text.toLowerCase().split(/\\s+/).map((token) => token.trim()).filter(Boolean))).slice(0, 8); const tokenFilters: Prisma.ProductWhereInput[] = tokens.flatMap((token) => [{ name:',
    'const tokens = Array.from(new Set(parsed.text.toLowerCase().split(/\\s+/).map((token) => token.trim()).filter(Boolean))).slice(0, 8); const tokenFilters: Prisma.ProductWhereInput[] = tokens.flatMap((token) => { const singular = normalizeSearchToken(token); const variants = Array.from(new Set([token, singular, singular.endsWith("s") ? singular.slice(0, -1) : `${singular}s`])); return variants.flatMap((variant) => [{ name:'
  );
  service = service.replace(
    '{ vendor: { storeSlug: { contains: token, mode: "insensitive" } } }]); if (tokenFilters.length) where.OR = tokenFilters;',
    '{ vendor: { storeSlug: { contains: token, mode: "insensitive" } } }, { tags: { has: token } }, { tags: { has: singular } }]); }); if (tokenFilters.length) where.OR = tokenFilters;'
  );
  fs.writeFileSync(servicePath, service);
}

console.log("Sponsored products and product tags schema/search fields ensured.");
