const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

function addModel(model) {
  const match = model.match(/model\s+(\w+)\s*\{/);
  if (!match) throw new Error("Invalid compatibility model");
  const name = match[1];
  if (!schema.includes(`model ${name} {`)) schema += `\n${model}\n`;
}

// store_public_profiles is application-maintained and already has its own
// Prisma compatibility model. Add the visibility column to that model so
// Prisma does not try to remove the live column during db push.
if (schema.includes("model StorePublicProfile {") && !/model StorePublicProfile \{[\s\S]*?\n\s*visibility\s+String/.test(schema)) {
  const start = schema.indexOf("model StorePublicProfile {");
  const marker = schema.indexOf("  createdAt", start);
  if (marker === -1) throw new Error("StorePublicProfile.createdAt marker not found");
  schema = schema.slice(0, marker) + '  visibility  String        @default("PUBLIC")\n' + schema.slice(marker);
}

addModel(`model AdCampaign {
  id              String   @id
  vendorId        String   @map("vendor_id")
  name            String
  objective       String   @default("STORE_VISITS")
  targetType      String   @default("STORE") @map("target_type")
  targetId        String?  @map("target_id")
  targetCategory  String?  @map("target_category")
  targetLocation  String?  @map("target_location")
  durationDays    Int      @map("duration_days")
  price           Decimal  @db.Decimal(14, 2)
  paymentReference String  @unique @map("payment_reference")
  status          String   @default("PENDING_PAYMENT")
  startAt         DateTime? @map("start_at") @db.Timestamptz(6)
  endAt           DateTime? @map("end_at") @db.Timestamptz(6)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)
  @@index([status, startAt, endAt], map: "ad_campaigns_active_idx")
  @@map("ad_campaigns")
}`);

addModel(`model AdEvent {
  id          String   @id
  campaignId  String   @map("campaign_id")
  eventType   String   @map("event_type")
  visitorKey  String?  @map("visitor_key")
  metadata    Json?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@index([campaignId, eventType, createdAt], map: "ad_events_campaign_idx")
  @@index([campaignId, eventType, visitorKey, createdAt], map: "ad_events_visitor_idx")
  @@map("ad_events")
}`);

addModel(`model Service {
  id             String   @id
  vendorId       String   @map("vendor_id")
  categorySlug   String?  @map("category_slug")
  title          String
  slug           String   @unique
  description    String
  price          Decimal? @db.Decimal(14, 2)
  priceType      String   @default("FIXED") @map("price_type")
  currency       String   @default("NGN")
  location       String?
  serviceArea    String?  @map("service_area")
  bookingRequired Boolean @default(false) @map("booking_required")
  status         String   @default("ACTIVE")
  imageUrl       String?  @map("image_url")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)
  @@index([vendorId, status], map: "services_vendor_idx")
  @@index([categorySlug, status], map: "services_category_idx")
  @@map("services")
}`);

fs.writeFileSync(schemaPath, schema);
console.log("Raw marketplace Prisma compatibility models ensured for ads, services, and store visibility.");
