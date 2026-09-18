const { execFileSync } = require("node:child_process");
const path = require("node:path");
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], {
  input: "ALTER TABLE product_alerts ADD COLUMN IF NOT EXISTS waitlist_seen_at TIMESTAMPTZ",
  stdio: ["pipe", "inherit", "inherit"],
});
console.log("Waitlist acknowledgement column ensured.");