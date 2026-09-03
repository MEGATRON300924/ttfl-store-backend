const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

if (schema.includes("model Affiliate {")) {
  process.stdout.write("Affiliate Prisma models already present.\n");
  process.exit(0);
}

const userRelation = /^(\s*)supportMessages\s+SupportMessage\[\]\s*$/m;
const orderRelation = /^(\s*)couponRedemption\s+CouponRedemption\?\s*$/m;

if (!userRelation.test(schema) || !orderRelation.test(schema)) {
  throw new Error("Could not find the User/Order relation markers in prisma/schema.prisma");
}

schema = schema.replace(userRelation, (line, indent) => `${line}\n${indent}affiliates                Affiliate[]`);
schema = schema.replace(orderRelation, (line, indent) => `${line}\n${indent}affiliateAttributions    AffiliateAttribution[]\n${indent}affiliateCommissions     AffiliateCommission[]`);

schema += `

// ---------------------------------------------------------------------------
// Affiliate program
// ---------------------------------------------------------------------------

model Affiliate {
  id              String   @id
  userId          String   @unique @map("user_id")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  code            String   @unique
  status          String   @default("ACTIVE")
  commissionRate  Decimal  @default(5) @db.Decimal(5, 2) @map("commission_rate")
  clicks          Int      @default(0)
  conversions     Int      @default(0)
  pendingEarnings Decimal  @default(0) @db.Decimal(12, 2) @map("pending_earnings")
  paidEarnings    Decimal  @default(0) @db.Decimal(12, 2) @map("paid_earnings")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @default(now()) @map("updated_at")
  clicksLog       AffiliateClick[]
  attributions    AffiliateAttribution[]
  commissions     AffiliateCommission[]
  @@map("affiliates")
}

model AffiliateClick {
  id          String    @id
  affiliateId String    @map("affiliate_id")
  affiliate   Affiliate @relation(fields: [affiliateId], references: [id], onDelete: Cascade)
  sessionId   String?   @map("session_id")
  landingPath String?   @map("landing_path")
  source      String?
  createdAt   DateTime  @default(now()) @map("created_at")
  @@index([affiliateId], map: "affiliate_clicks_affiliate_idx")
  @@index([createdAt], map: "affiliate_clicks_created_idx")
  @@map("affiliate_clicks")
}

model AffiliateAttribution {
  id             String    @id
  affiliateId    String    @map("affiliate_id")
  affiliate      Affiliate @relation(fields: [affiliateId], references: [id], onDelete: Cascade)
  orderId        String    @unique @map("order_id")
  order          Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  commissionRate Decimal   @db.Decimal(5, 2) @map("commission_rate")
  createdAt      DateTime  @default(now()) @map("created_at")
  @@index([affiliateId], map: "affiliate_attributions_affiliate_idx")
  @@map("affiliate_attributions")
}

model AffiliateCommission {
  id           String    @id
  affiliateId  String    @map("affiliate_id")
  affiliate    Affiliate @relation(fields: [affiliateId], references: [id], onDelete: Cascade)
  orderId      String    @unique @map("order_id")
  order        Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderAmount  Decimal   @db.Decimal(12, 2) @map("order_amount")
  amount       Decimal   @db.Decimal(12, 2)
  status       String    @default("PENDING")
  createdAt    DateTime  @default(now()) @map("created_at")
  paidAt       DateTime? @map("paid_at")
  @@index([affiliateId], map: "affiliate_commissions_affiliate_idx")
  @@index([status], map: "affiliate_commissions_status_idx")
  @@map("affiliate_commissions")
}
`;

fs.writeFileSync(schemaPath, schema);
process.stdout.write("Affiliate Prisma models prepared without deleting existing affiliate data.\n");
