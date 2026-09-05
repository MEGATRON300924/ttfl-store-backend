const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

const userRelation = /^(\s*)supportMessages\s+SupportMessage\[\]\s*$/m;
const orderRelation = /^(\s*)couponRedemption\s+CouponRedemption\?\s*$/m;

if (!schema.includes("affiliates                Affiliate[]")) {
  if (!userRelation.test(schema)) {
    throw new Error("Could not find the User relation marker in prisma/schema.prisma");
  }
  schema = schema.replace(userRelation, (line, indent) => `${line}\n${indent}affiliates                Affiliate[]`);
}

if (!schema.includes("affiliateAttributions    AffiliateAttribution[]")) {
  if (!orderRelation.test(schema)) {
    throw new Error("Could not find the Order relation marker in prisma/schema.prisma");
  }
  schema = schema.replace(orderRelation, (line, indent) => `${line}\n${indent}affiliateAttributions    AffiliateAttribution[]\n${indent}affiliateCommissions     AffiliateCommission[]`);
}

if (!schema.includes("model Affiliate {")) {
  schema += `

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
}

if (!schema.includes("model StorePublicProfile {")) {
  schema += `

model StorePublicProfile {
  id          String        @id
  vendorId    String        @unique @map("vendor_id")
  vendor      VendorProfile @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  headline    String?
  description String?
  theme       String        @default("CLASSIC")
  accentColor String        @default("#E8622C") @map("accent_color")
  layout      String        @default("STANDARD")
  customUrl   String?       @unique @map("custom_url")
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @default(now()) @map("updated_at")
  @@map("store_public_profiles")
}

model StoreBadge {
  id        String        @id
  vendorId  String        @map("vendor_id")
  vendor    VendorProfile @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  badge     String
  createdAt DateTime      @default(now()) @map("created_at")
  @@unique([vendorId, badge])
  @@index([vendorId], map: "store_badges_vendor_idx")
  @@map("store_badges")
}

model StoreGalleryImage {
  id        String        @id
  vendorId  String        @map("vendor_id")
  vendor    VendorProfile @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  url       String
  publicId  String        @map("public_id")
  position  Int           @default(0)
  createdAt DateTime      @default(now()) @map("created_at")
  @@index([vendorId, position], map: "store_gallery_vendor_idx")
  @@map("store_gallery_images")
}
`;
}

if (!schema.includes("storePublicProfile StorePublicProfile?")) {
  const vendorRelation = /^(\s*)payouts\s+Payout\[\]\s*$/m;
  if (!vendorRelation.test(schema)) {
    throw new Error("Could not find the VendorProfile relation marker in prisma/schema.prisma");
  }
  schema = schema.replace(vendorRelation, (line, indent) => `${line}\n${indent}storePublicProfile StorePublicProfile?\n${indent}storeBadges        StoreBadge[]\n${indent}storeGalleryImages StoreGalleryImage[]`);
}

if (!schema.includes("paystackSubaccountCode String?")) {
  const vendorMarker = /^(\s*)commissionRateOverride Decimal\? @db\.Decimal\(5, 2\)\s*$/m;
  if (!vendorMarker.test(schema)) {
    throw new Error("Could not find VendorProfile commission field in prisma/schema.prisma");
  }
  schema = schema.replace(vendorMarker, (line, indent) => `${line}\n${indent}paystackSubaccountCode String? @unique\n${indent}paystackBankCode String?\n${indent}paystackAccountLast4 String?\n${indent}paystackAccountName String?\n${indent}paystackBankName String?\n${indent}paystackSubaccountActive Boolean @default(false)\n${indent}paystackSubaccountVerified Boolean @default(false)`);
}

if (!schema.includes("model Broadcast {")) {
  schema += `

model Broadcast {
  id              String   @id
  title           String
  message         String
  emailSubject    String?  @map("email_subject")
  sendPopup       Boolean  @default(false) @map("send_popup")
  sendEmail       Boolean  @default(false) @map("send_email")
  audience        Json
  recipientCount Int      @default(0) @map("recipient_count")
  createdBy       String   @map("created_by")
  createdAt       DateTime @default(now()) @map("created_at")
  @@map("ttfl_broadcasts")
}
`;
}

fs.writeFileSync(schemaPath, schema);
process.stdout.write("Prisma schema prepared without dropping existing affiliate, store-profile, broadcast, or Paystack settlement data.\n");
