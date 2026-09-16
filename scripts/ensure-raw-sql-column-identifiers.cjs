const fs = require("node:fs");
const path = require("node:path");

// Do not rewrite raw SQL identifiers during the build. The main Prisma schema
// uses camelCase database columns unless a field explicitly has @map(...).
// Rewriting quoted Prisma field names such as p."deletedAt" to p.deleted_at
// changes valid SQL into references to columns that do not exist.
//
// Raw SQL should be written explicitly for the real database column name:
//   p."deletedAt"  -> normal Prisma-generated column
//   p.coming_soon   -> explicitly @map("coming_soon") column
//   vs."planId"    -> normal Prisma-generated column
//   v."storeName"  -> normal Prisma-generated column

const roots = [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")];
const extensions = new Set([".ts", ".tsx", ".js", ".cjs"]);

// These are the database columns that are intentionally snake_case because
// their Prisma fields explicitly use @map(...). They are allowed in raw SQL.
const allowedMappedColumns = new Set([
  "coming_soon",
  "available_at",
  "vendor_id",
  "user_id",
  "invited_at",
  "accepted_at",
  "created_at",
  "updated_at",
  "token_hash",
  "expires_at",
  "invited_by",
  "last_error",
  "available_at",
  "sent_at",
  "product_id",
  "old_price",
  "new_price",
  "changed_at",
  "target_price",
  "notified_at",
  "email_enabled",
  "whatsapp_enabled",
  "marketing_enabled",
  "promotion_type",
  "promotion_id",
  "session_id",
  "quantity",
  "revenue",
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }

    if (!extensions.has(path.extname(entry.name))) continue;

    const source = fs.readFileSync(filePath, "utf8");
    if (!source.includes("$queryRaw") && !source.includes("$executeRaw")) continue;

    // Fail the build only when a raw query contains an unquoted camelCase
    // identifier. Quoted camelCase identifiers are valid PostgreSQL columns;
    // snake_case identifiers are also valid when explicitly @map(...)'d.
    const rawCamelCaseIdentifier = /\b(?:p|vs|v|vp|oi|vo|o|fd)\.[A-Za-z_][A-Za-z0-9]*[A-Z][A-Za-z0-9_]*/;
    const match = source.match(rawCamelCaseIdentifier);
    if (match) {
      throw new Error(
        `Unquoted camelCase raw SQL identifier found in ${path.relative(process.cwd(), filePath)}: ${match[0]}`
      );
    }
  }
}

walk(roots[0]);
walk(roots[1]);

console.log("Raw SQL column identifiers validated without rewriting source files.");
