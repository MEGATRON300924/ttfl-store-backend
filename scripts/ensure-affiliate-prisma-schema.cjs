const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");

if (schema.includes("model Affiliate {")) {
  process.stdout.write("Affiliate Prisma models already present.\n");
  process.exit(0);
}

const userMarker = "  supportMessages           SupportMessage[]\n";
const orderMarker = "  couponRedemption CouponRedemption?\n";

if (!schema.includes(userMarker) || !schema.includes(orderMarker)) {
  throw new Error("Could not find the expected User/Order relation markers in prisma/schema.prisma");
}

let updated = schema.replace(userMarker, `${userMarker}  affiliates                Affiliate[]\n`);
updated = updated.replace(orderMarker, `${orderMarker}  affiliateAttributions AffiliateAttribution[]\n  affiliateCommissions   AffiliateCommission[]\n`);

updated += `

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

fs.writeFileSync(schemaPath, updated);
process.stdout.write("Affiliate Prisma models added to schema without touching existing data.\n");
