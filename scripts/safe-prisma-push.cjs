const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const prismaCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const temporarySchemaPath = path.join(process.cwd(), ".prisma-safe-push.schema.prisma");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for the Prisma schema safety check.");
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) {
  console.error(`Prisma schema not found: ${schemaPath}`);
  process.exit(1);
}

function run(args, inherit = false) {
  const result = spawnSync(prismaCommand, ["prisma", ...args], {
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: false,
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(output || `Prisma exited with code ${result.status}`);
  }

  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${scriptPath} exited with code ${result.status}`);
}

async function databaseHasUsableProductIdUniqueIndex() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'products'
        AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
        AND indexdef ILIKE '%("publicProductId")%'
        AND indexdef NOT ILIKE '% WHERE %'
      LIMIT 1
    `);

    return rows.length > 0;
  } finally {
    await prisma.$disconnect();
  }
}

async function finalizeProductIdConstraint() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const duplicateRows = await prisma.$queryRawUnsafe(`
      SELECT "publicProductId", COUNT(*)::int AS count
      FROM "products"
      WHERE "publicProductId" IS NOT NULL
      GROUP BY "publicProductId"
      HAVING COUNT(*) > 1
      LIMIT 1
    `);

    if (duplicateRows.length > 0) {
      throw new Error(`Duplicate publicProductId value detected: ${duplicateRows[0].publicProductId}`);
    }

    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'products'
        AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
        AND indexdef ILIKE '%("publicProductId")%'
        AND indexdef NOT ILIKE '% WHERE %'
      LIMIT 1
    `);

    if (indexes.length === 0) {
      await prisma.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "products_publicProductId_key" ON "products" ("publicProductId")'
      );
      console.log("Product ID unique index created safely after existing products were populated.");
    } else {
      console.log(`Product ID unique index already exists: ${indexes[0].indexname}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function databaseHasPaystackSubaccountUniqueIndex() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'vendor_profiles'
        AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
        AND indexdef ILIKE '%("paystack_subaccount_code")%'
      LIMIT 1
    `);

    return rows.length > 0;
  } finally {
    await prisma.$disconnect();
  }
}

async function finalizePaystackSubaccountConstraint() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const duplicateRows = await prisma.$queryRawUnsafe(`
      SELECT "paystack_subaccount_code", COUNT(*)::int AS count
      FROM "vendor_profiles"
      WHERE "paystack_subaccount_code" IS NOT NULL
      GROUP BY "paystack_subaccount_code"
      HAVING COUNT(*) > 1
      LIMIT 1
    `);

    if (duplicateRows.length > 0) {
      throw new Error(
        `Duplicate Paystack subaccount code detected: ${duplicateRows[0].paystack_subaccount_code}. The unique constraint was not created.`
      );
    }

    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'vendor_profiles'
        AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
        AND indexdef ILIKE '%("paystack_subaccount_code")%'
      LIMIT 1
    `);

    if (indexes.length === 0) {
      await prisma.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "vendor_profiles_paystack_subaccount_code_key" ON "vendor_profiles" ("paystack_subaccount_code")'
      );
      console.log("Paystack subaccount unique index created safely after checking existing values.");
    } else {
      console.log(`Paystack subaccount unique index already exists: ${indexes[0].indexname}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

console.log("Checking Prisma schema changes for destructive database operations...");

let diff;
try {
  diff = run([
    "migrate",
    "diff",
    "--from-url",
    process.env.DATABASE_URL,
    "--to-schema-datamodel",
    schemaPath,
    "--script",
  ]);
} catch (error) {
  console.error("Prisma could not compare the database with the schema. Deployment stopped to avoid making an unsafe schema change.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const destructivePatterns = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+INDEX\b/i,
];

const destructiveOperations = destructivePatterns.filter((pattern) => pattern.test(diff));

if (destructiveOperations.length > 0) {
  console.error("\nPrisma detected a potentially destructive schema change.");
  console.error("Deployment was stopped. Existing TTFL Store data will not be deleted automatically.\n");
  console.error("Detected operation types:");
  for (const pattern of destructiveOperations) console.error(`- ${pattern}`);
  console.error("\nCreate and review an intentional Prisma migration before deploying this schema change.");
  process.exit(1);
}

console.log("No destructive SQL detected. Applying the schema without accepting data loss...");

const schema = fs.readFileSync(schemaPath, "utf8");
const productIdPattern = /(publicProductId\s+String\?)\s+@unique/;
const paystackSubaccountPattern = /(paystackSubaccountCode\s+String\?)\s+@unique/;
const hasProductIdUniqueField = productIdPattern.test(schema);
const hasPaystackSubaccountUniqueField = paystackSubaccountPattern.test(schema);

async function main() {
  const uniqueProductIndexExists = await databaseHasUsableProductIdUniqueIndex();
  const uniquePaystackIndexExists = await databaseHasPaystackSubaccountUniqueIndex();

  const needsProductConstraintRollout = hasProductIdUniqueField && !uniqueProductIndexExists;
  const needsPaystackConstraintRollout = hasPaystackSubaccountUniqueField && !uniquePaystackIndexExists;

  if (needsProductConstraintRollout || needsPaystackConstraintRollout) {
    let temporarySchema = schema;

    if (needsProductConstraintRollout) {
      console.log("Product ID unique index is not yet safely established. Applying Product ID column without the unique constraint first...");
      temporarySchema = temporarySchema.replace(productIdPattern, "$1");
    }

    if (needsPaystackConstraintRollout) {
      console.log("Paystack subaccount unique index is not yet safely established. Applying the field without the unique constraint first...");
      temporarySchema = temporarySchema.replace(paystackSubaccountPattern, "$1");
    }

    fs.writeFileSync(temporarySchemaPath, temporarySchema);

    try {
      run(["db", "push", "--skip-generate", "--schema", temporarySchemaPath], true);
    } finally {
      if (fs.existsSync(temporarySchemaPath)) fs.unlinkSync(temporarySchemaPath);
    }

    if (needsProductConstraintRollout) {
      runNodeScript(path.join(process.cwd(), "scripts", "backfill-product-ids.cjs"));
      await finalizeProductIdConstraint();
    }

    if (needsPaystackConstraintRollout) {
      await finalizePaystackSubaccountConstraint();
    }

    return;
  }

  run(["db", "push", "--skip-generate"], true);

  if (hasProductIdUniqueField) {
    runNodeScript(path.join(process.cwd(), "scripts", "backfill-product-ids.cjs"));
    await finalizeProductIdConstraint();
  }

  if (hasPaystackSubaccountUniqueField) {
    await finalizePaystackSubaccountConstraint();
  }
}

main()
  .then(() => console.log("Prisma schema deployment completed without allowing destructive data loss."))
  .catch((error) => {
    console.error("Prisma schema deployment failed. No --accept-data-loss flag was used, so existing data remains protected.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
