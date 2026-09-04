const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the safe Prisma schema check.");
}

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");

if (!fs.existsSync(schemaPath)) {
  throw new Error(`Prisma schema not found at ${schemaPath}`);
}

function run(args) {
  const result = spawnSync("npx", ["prisma", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: process.env,
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

process.stdout.write("Checking Prisma schema changes for destructive operations...\n");

const diff = run([
  "migrate",
  "diff",
  "--from-url",
  databaseUrl,
  "--to-schema-datamodel",
  schemaPath,
  "--script",
]);

const destructivePatterns = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bDROP\s+DATABASE\b/i,
];

const destructive = destructivePatterns.filter((pattern) => pattern.test(diff));

if (destructive.length > 0) {
  process.stderr.write("\nERROR: Prisma detected a potentially destructive database change.\n");
  process.stderr.write("The deployment has been stopped to protect existing TTFL Store data.\n\n");
  process.stderr.write("Detected operations:\n");
  for (const pattern of destructive) {
    process.stderr.write(`- ${pattern}\n`);
  }
  process.stderr.write("\nReview prisma/schema.prisma and create a deliberate migration before deploying this change.\n");
  process.exit(1);
}

process.stdout.write("No destructive SQL detected. Applying additive/non-destructive schema changes...\n");
run(["db", "push", "--skip-generate"]);
process.stdout.write("Prisma schema synchronized without accepting data loss.\n");
