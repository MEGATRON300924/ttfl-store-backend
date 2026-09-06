const { spawnSync } = require("node:child_process");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to restore the Prisma schema from the live database.");
  process.exit(1);
}

const prismaCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(prismaCommand, ["prisma", "db", "pull", "--force"], {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error("Prisma schema restoration failed:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`Prisma schema restoration failed with exit code ${result.status}.`);
  process.exit(result.status ?? 1);
}

console.log("Prisma schema restored from the live database before local schema extensions were applied.");
