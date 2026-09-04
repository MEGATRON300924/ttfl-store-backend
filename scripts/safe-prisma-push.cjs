const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const prismaCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");

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

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(output || `Prisma exited with code ${result.status}`);
  }

  return `${result.stdout || ""}\n${result.stderr || ""}`;
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
];

const destructiveOperations = destructivePatterns.filter((pattern) => pattern.test(diff));

if (destructiveOperations.length > 0) {
  console.error("\nPrisma detected a potentially destructive schema change.");
  console.error("Deployment was stopped. Existing TTFL Store data will not be deleted automatically.\n");
  console.error("Detected operation types:");
  for (const pattern of destructiveOperations) {
    console.error(`- ${pattern}`);
  }
  console.error("\nCreate and review an intentional Prisma migration before deploying this schema change.");
  process.exit(1);
}

console.log("No destructive SQL detected. Applying the schema without accepting data loss...");

const result = spawnSync(prismaCommand, ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(`Prisma schema deployment could not start: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("Prisma schema deployment failed. No --accept-data-loss flag was used, so existing data remains protected.");
  process.exit(result.status ?? 1);
}

console.log("Prisma schema deployment completed without allowing destructive data loss.");
