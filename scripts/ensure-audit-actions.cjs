const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

const actions = [
  "VENDOR_STAFF_INVITED",
  "VENDOR_STAFF_UPDATED",
  "VENDOR_STAFF_REMOVED",
  "VENDOR_STAFF_ACCEPTED",
  "ADMIN_FLASH_DEAL_CREATED",
  "ADMIN_FLASH_DEAL_CANCELLED",
  "ADMIN_FEATURED_PRODUCT_CREATED",
  "ADMIN_FEATURED_STORE_CREATED",
  "PRODUCT_AVAILABILITY_NOTIFIED",
];

const enumStart = schema.indexOf("enum AuditAction {");
if (enumStart === -1) throw new Error("AuditAction enum not found in prisma/schema.prisma");
const enumEnd = schema.indexOf("\n}", enumStart);
if (enumEnd === -1) throw new Error("AuditAction enum is malformed");
const enumBlock = schema.slice(enumStart, enumEnd);
const missing = actions.filter((action) => !new RegExp(`^\\s*${action}\\s*$`, "m").test(enumBlock));
if (missing.length > 0) schema = schema.slice(0, enumEnd) + "\n" + missing.map((action) => `  ${action}`).join("\n") + schema.slice(enumEnd);

function addModel(model) {
  const name = model.match(/model\s+(\w+)\s*\{/)[1];
  if (!schema.includes(`model ${name} {`)) schema += `\n${model}\n`;
}

addModel(`model RewardWallet {
  id String @id
  userId String @unique @map("user_id")
  pointsBalance Int @default(0) @map("points_balance")
  lifetimeEarned Int @default(0) @map("lifetime_earned")
  lifetimeRedeemed Int @default(0) @map("lifetime_redeemed")
  lifetimeSpend Decimal @default(0) @map("lifetime_spend")
  completedOrders Int @default(0) @map("completed_orders")
  level String @default("BRONZE")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@map("reward_wallets")
}`);

addModel(`model RewardLedger {
  id String @id
  userId String @map("user_id")
  type String
  points Int
  description String
  referenceType String? @map("reference_type")
  referenceId String? @map("reference_id")
  idempotencyKey String? @unique @map("idempotency_key")
  expiresAt DateTime? @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([userId,createdAt(sort: Desc)], name:"reward_ledger_user_created_idx")
  @@index([referenceType,referenceId], name:"reward_ledger_reference_idx")
  @@map("reward_ledger")
}`);

addModel(`model RewardPurchaseClaim {
  id String @id
  orderId String @unique @map("order_id")
  userId String @map("user_id")
  amount Decimal
  createdAt DateTime @default(now()) @map("created_at")
  @@index([userId,createdAt(sort: Desc)], name:"reward_purchase_claims_user_idx")
  @@map("reward_purchase_claims")
}`);

addModel(`model RewardSetting {
  key String @id
  value String
  updatedAt DateTime @updatedAt @map("updated_at")
  @@map("reward_settings")
}`);

fs.writeFileSync(schemaPath, schema);
console.log("Prisma audit actions and TTFL Rewards schema prepared.");
