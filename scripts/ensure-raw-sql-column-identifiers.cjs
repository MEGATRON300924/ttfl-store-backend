const fs = require("node:fs");
const path = require("node:path");

// Do not rewrite raw SQL identifiers during the build. The main Prisma schema
// uses camelCase database columns unless a field explicitly has @map(...).
// Rewriting quoted Prisma field names such as p."deletedAt" to p.deleted_at
// changes valid SQL into references to columns that do not exist.
//
// This validator only inspects actual SQL strings passed to Prisma raw-query
// APIs. It must not inspect normal TypeScript/Prisma expressions such as
// p.comingSoon, because those are JavaScript property accesses, not SQL.

const roots = [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")];
const extensions = new Set([".ts", ".tsx", ".js", ".cjs"]);

function validateSql(sql, filePath) {
  // Remove template interpolations before checking identifiers. Expressions
  // such as ${p.comingSoon} are JavaScript, not SQL identifiers.
  const sqlText = sql.replace(/\$\{[\s\S]*?\}/g, "");
  const rawCamelCaseIdentifier = /\b(?:p|vs|v|vp|oi|vo|o|fd)\.[A-Za-z_][A-Za-z0-9]*[A-Z][A-Za-z0-9_]*/;
  const match = sqlText.match(rawCamelCaseIdentifier);
  if (match) {
    throw new Error(
      `Unquoted camelCase raw SQL identifier found in ${path.relative(process.cwd(), filePath)}: ${match[0]}`
    );
  }
}

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

    // Tagged template raw queries: prisma.$queryRaw`...`
    const taggedTemplate = /\$(?:queryRaw|executeRaw)\s*`([\s\S]*?)`/g;
    for (const match of source.matchAll(taggedTemplate)) {
      validateSql(match[1], filePath);
    }

    // Unsafe raw queries using a template literal: prisma.$queryRawUnsafe(`...`)
    const templateArgument = /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(\s*`([\s\S]*?)`/g;
    for (const match of source.matchAll(templateArgument)) {
      validateSql(match[1], filePath);
    }

    // Unsafe raw queries using a normal quoted string.
    const quotedArgument = /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(\s*(["'])([\s\S]*?)\1/g;
    for (const match of source.matchAll(quotedArgument)) {
      validateSql(match[2], filePath);
    }
  }
}

walk(roots[0]);
walk(roots[1]);

console.log("Raw SQL column identifiers validated without rewriting source files.");
