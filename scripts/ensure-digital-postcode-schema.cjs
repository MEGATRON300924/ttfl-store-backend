const { execFileSync } = require("node:child_process");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

const sql = [
  "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS digital_postcode TEXT;",
  "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_postcode TEXT;",
].join("\n");

execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});
console.log("Digital postcode columns are ready.");
