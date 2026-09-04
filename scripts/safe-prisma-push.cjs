const { spawnSync } = require("node:child_process");

const prismaCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(prismaCommand, ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(`Prisma schema deployment could not start: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("Prisma schema deployment stopped. No --accept-data-loss flag was used, so Prisma must refuse any destructive change instead of deleting existing data.");
  process.exit(result.status ?? 1);
}

console.log("Prisma schema deployment completed without allowing destructive data loss.");
