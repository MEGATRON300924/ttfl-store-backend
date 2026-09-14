const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

if (!schema.includes("model FlashDealReservation {")) {
  schema += `

model FlashDealReservation {
  id          String   @id
  flashDealId String   @map("flash_deal_id")
  orderId     String   @map("order_id")
  quantity    Int
  status      String   @default("ACTIVE")
  expiresAt   DateTime @map("expires_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([flashDealId, orderId], map: "flash_deal_reservations_flash_deal_order_unique")
  @@index([flashDealId, status, expiresAt], map: "flash_deal_reservations_active_idx")
  @@map("flash_deal_reservations")
}
`;
  fs.writeFileSync(schemaPath, schema);
}

console.log("Flash Deal reservation Prisma model ensured without changing existing reservation data.");
