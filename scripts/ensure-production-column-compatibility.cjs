const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const schemaPath = path.join(root, "prisma", "schema.prisma");

function mapProductVendorId() {
  let schema = fs.readFileSync(schemaPath, "utf8");
  const start = schema.indexOf("model Product {");
  if (start < 0) throw new Error("Product model not found in Prisma schema");
  const end = schema.indexOf("\n}", start);
  if (end < 0) throw new Error("Product model is malformed");
  const block = schema.slice(start, end);
  const match = block.match(/^\s*vendorId\s+String[^\n]*$/m);
  if (!match) throw new Error("Product.vendorId field not found in Prisma schema");
  if (!match[0].includes("@map(")) {
    const replacement = `${match[0]} @map("vendor_id")`;
    schema = schema.slice(0, start + match.index) + replacement + schema.slice(start + match.index + match[0].length);
    fs.writeFileSync(schemaPath, schema);
    console.log('Mapped Prisma Product.vendorId to products.vendor_id.');
  }
}

function patchProductRawSql() {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx|js|cjs)$/.test(entry.name)) files.push(file);
    }
  }
  walk(path.join(root, "src"));
  walk(path.join(root, "scripts"));

  for (const file of files) {
    let source = fs.readFileSync(file, "utf8");
    if (!/(FROM|JOIN)\s+products\s+p\b/i.test(source)) continue;
    const next = source
      .replace(/p\."vendorId"/g, "p.vendor_id")
      .replace(/p\.deleted_at\b/g, 'p."deletedAt"');
    if (next !== source) {
      fs.writeFileSync(file, next);
      console.log(`Patched product raw SQL identifiers in ${path.relative(root, file)}.`);
    }
  }
}

function patchVendorProfileRawSql() {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx|js|cjs)$/.test(entry.name)) files.push(file);
    }
  }
  walk(path.join(root, "src"));

  const replacements = [
    [/vp\.store_name\b/g, 'vp."storeName"'],
    [/vp\.store_slug\b/g, 'vp."storeSlug"'],
    [/vp\.whatsapp_number\b/g, 'vp."whatsappNumber"'],
    [/vp\.logo_url\b/g, 'vp."logoUrl"'],
    [/vp\.banner_url\b/g, 'vp."bannerUrl"'],
    [/vp\.verified\b/g, 'vp."verified"'],
    [/vp\.created_at\b/g, 'vp."createdAt"'],
    [/vp\.view_count\b/g, 'vp."viewCount"'],
  ];

  for (const file of files) {
    let source = fs.readFileSync(file, "utf8");
    if (!/vendor_profiles\s+vp\b/i.test(source)) continue;
    let next = source;
    for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
    if (next !== source) {
      fs.writeFileSync(file, next);
      console.log(`Patched vendor profile raw SQL identifiers in ${path.relative(root, file)}.`);
    }
  }
}

mapProductVendorId();
patchProductRawSql();
patchVendorProfileRawSql();
console.log("Production column compatibility checks complete.");
