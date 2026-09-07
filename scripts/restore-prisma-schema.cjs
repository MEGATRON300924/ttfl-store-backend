const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const sourceUrl = "https://raw.githubusercontent.com/MEGATRON300924/ttfl-store-backend/756491e9fd5c12c24e611509626ced3c8b818365/prisma/schema.prisma";
function download(url) { return new Promise((resolve, reject) => { https.get(url, (response) => { if (response.statusCode !== 200) { response.resume(); reject(new Error(`Schema source returned HTTP ${response.statusCode}`)); return; } let body = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { body += chunk; }); response.on("end", () => resolve(body)); }).on("error", reject); }); }
(async () => { const schema = await download(sourceUrl); if (!schema.includes("model User {") || !schema.includes("model Order {") || !schema.includes("model VendorProfile {")) throw new Error("Downloaded Prisma schema failed validation."); fs.writeFileSync(schemaPath, schema); for (const script of ["ensure-affiliate-prisma-schema.cjs", "ensure-tracking-schema.cjs", "ensure-vendor-staff-schema.cjs", "ensure-audit-actions.cjs", "ensure-flash-deals-schema.cjs", "ensure-store-badges.cjs"]) execFileSync(process.execPath, [path.join(process.cwd(), "scripts", script)], { stdio: "inherit" }); console.log("Canonical Prisma schema restored and all local schema extensions applied."); })().catch((error) => { console.error("Prisma schema restoration failed:", error); process.exit(1); });
