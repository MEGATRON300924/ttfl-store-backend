const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

function addEnumValues(enumName, values) {
  let start = schema.indexOf(`enum ${enumName} {`);
  if (start < 0) {
    schema += `\nenum ${enumName} {\n${values.map((value) => `  ${value}`).join("\n")}\n}\n`;
    return;
  }
  const end = schema.indexOf("\n}", start);
  if (end < 0) throw new Error(`${enumName} enum malformed`);
  const block = schema.slice(start, end);
  const missing = values.filter((value) => !new RegExp(`^\\s*${value}\\s*$`, "m").test(block));
  if (missing.length) schema = `${schema.slice(0, end)}\n${missing.map((value) => `  ${value}`).join("\n")}${schema.slice(end)}`;
}

function addField(modelName, marker, field) {
  const start = schema.indexOf(`model ${modelName} {`);
  if (start < 0) throw new Error(`${modelName} model not found`);
  const end = schema.indexOf("\n}", start);
  if (end < 0) throw new Error(`${modelName} model malformed`);
  const block = schema.slice(start, end);
  const fieldName = field.trim().split(/\s+/)[0];
  if (new RegExp(`^\\s*${fieldName}\\s+`, "m").test(block)) return;
  let markerIndex = schema.indexOf(marker, start);
  if (markerIndex < 0 || markerIndex > end) {
    const markerFieldName = marker.trim().split(/\s+/).pop();
    if (markerFieldName) {
      const fallback = block.match(new RegExp(`^\\s*${markerFieldName}\\s+[^\\n]*$`, "m"));
      if (fallback?.index != null) markerIndex = start + fallback.index;
    }
  }
  if (markerIndex < 0 || markerIndex > end) throw new Error(`Could not insert ${fieldName} into ${modelName}`);
  schema = `${schema.slice(0, markerIndex)}  ${field}\n${schema.slice(markerIndex)}`;
}

function addModel(model) {
  const match = model.match(/model\s+(\w+)\s*\{/);
  if (!match) throw new Error("Invalid model definition");
  if (!schema.includes(`model ${match[1]} {`)) schema += `\n${model}\n`;
}

addEnumValues("AuditAction", ["VENDOR_STAFF_INVITED", "VENDOR_STAFF_UPDATED", "VENDOR_STAFF_REMOVED", "VENDOR_STAFF_ACCEPTED", "ADMIN_FLASH_DEAL_CREATED", "ADMIN_FLASH_DEAL_CANCELLED", "ADMIN_FEATURED_PRODUCT_CREATED", "ADMIN_FEATURED_STORE_CREATED", "PRODUCT_AVAILABILITY_NOTIFIED"]);
addEnumValues("ReferralType", ["PRODUCT_VIEW"]);

addField("VendorProfile", "  @@index([status])", "paystackSubaccountCode String?");
addField("VendorProfile", "  @@index([status])", "paystackBankCode String?");
addField("VendorProfile", "  @@index([status])", "paystackBankName String?");
addField("VendorProfile", "  @@index([status])", "paystackAccountLast4 String?");
addField("VendorProfile", "  @@index([status])", "paystackAccountName String?");
addField("VendorProfile", "  @@index([status])", "paystackSubaccountActive Boolean @default(false)");
addField("VendorProfile", "  @@index([status])", "paystackSubaccountVerified Boolean @default(false)");

addField("Product", "  createdAt", "publicProductId String? @unique");
addField("Product", "  createdAt", "estimatedDeliveryDays Int @default(7)");
addField("Product", "  createdAt", "comingSoon Boolean @default(false) @map(\"coming_soon\")");
addField("Product", "  createdAt", "availableAt DateTime? @map(\"available_at\")");
addField("Product", "  createdAt", "sponsored Boolean @default(false)");
addField("Product", "  createdAt", "sponsoredAt DateTime?");
addField("Product", "  createdAt", "tags String[] @default([])");

addField("VendorOrder", "  items OrderItem[]", "trackingEvents TrackingEvent[]");
addField("OrderItem", "  createdAt", "variantKey String?");
addField("OrderItem", "  createdAt", "variantLabel String?");
addField("OrderItem", "  createdAt", "variantOptions Json?");

addModel(`model TrackingEvent {
  id String @id @default(uuid())
  vendorOrderId String
  vendorOrder VendorOrder @relation(fields: [vendorOrderId], references: [id], onDelete: Cascade)
  checkpoint Int
  title String
  description String?
  avatar String @default("package")
  trackingUrl String?
  riderName String?
  riderPhone String?
  createdAt DateTime @default(now())
  @@unique([vendorOrderId, checkpoint])
  @@index([vendorOrderId])
  @@index([createdAt])
  @@map("tracking_events")
}`);

addModel(`model VendorStaff {
  id String @id
  vendorId String @map("vendor_id")
  userId String @map("user_id")
  role String
  permissions Json
  active Boolean @default(true)
  invitedAt DateTime @default(now()) @map("invited_at")
  acceptedAt DateTime? @map("accepted_at")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @map("updated_at")
  @@unique([vendorId, userId], map: "vendor_staff_vendor_user_unique")
  @@index([userId], map: "vendor_staff_user_idx")
  @@index([vendorId, active], map: "vendor_staff_vendor_active_idx")
  @@map("vendor_staff")
}`);

addModel(`model VendorStaffInvitation {
  id String @id
  vendorId String @map("vendor_id")
  email String
  role String
  permissions Json
  tokenHash String @unique @map("token_hash")
  expiresAt DateTime @map("expires_at")
  acceptedAt DateTime? @map("accepted_at")
  invitedBy String @map("invited_by")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([vendorId, email], map: "vendor_staff_invite_vendor_email_idx")
  @@index([expiresAt], map: "vendor_staff_invite_expires_idx")
  @@map("vendor_staff_invitations")
}`);

addModel(`model MaxEventOutbox {
  id String @id
  event String
  payload Json
  status String @default("PENDING")
  attempts Int @default(0)
  lastError String? @map("last_error")
  availableAt DateTime @default(now()) @map("available_at")
  sentAt DateTime? @map("sent_at")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([status, availableAt])
  @@map("max_event_outbox")
}`);

addModel(`model ProductAvailabilityNotification {
  id String @id
  productId String @map("product_id")
  userId String? @map("user_id")
  email String?
  whatsapp String?
  emailNotifiedAt DateTime? @map("email_notified_at")
  whatsappNotifiedAt DateTime? @map("whatsapp_notified_at")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt @map("updated_at")
  @@unique([productId, email], name: "product_availability_notifications_product_email_idx")
  @@unique([productId, whatsapp], name: "product_availability_notifications_product_whatsapp_idx")
  @@index([productId], name: "product_availability_notifications_product_idx")
  @@map("product_availability_notifications")
}`);

addModel(`model ProductPriceHistory {
  id String @id
  productId String @map("product_id")
  oldPrice Decimal? @map("old_price")
  newPrice Decimal @map("new_price")
  changedAt DateTime @default(now()) @map("changed_at")
  @@index([productId, changedAt(sort: Desc)], name: "product_price_history_product_idx")
  @@map("product_price_history")
}`);

addModel(`model ProductAlert {
  id String @id
  productId String @map("product_id")
  userId String? @map("user_id")
  email String?
  whatsapp String?
  type String
  targetPrice Decimal? @map("target_price")
  notifiedAt DateTime? @map("notified_at")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([productId, type, notifiedAt])
  @@map("product_alerts")
}`);
addField("ProductAlert", "  notifiedAt", "waitlistSeenAt DateTime? @map(\"waitlist_seen_at\")");

addModel(`model VendorNotificationPreference {
  id String @id
  vendorId String @unique @map("vendor_id")
  emailEnabled Boolean @default(true) @map("email_enabled")
  whatsappEnabled Boolean @default(true) @map("whatsapp_enabled")
  marketingEnabled Boolean @default(false) @map("marketing_enabled")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@map("vendor_notification_preferences")
}`);

addModel(`model PromotionEvent {
  id String @id
  promotionType String @map("promotion_type")
  promotionId String @map("promotion_id")
  vendorId String @map("vendor_id")
  productId String? @map("product_id")
  event String
  sessionId String? @map("session_id")
  userId String? @map("user_id")
  quantity Int?
  revenue Decimal?
  source String?
  createdAt DateTime @default(now())
  @@index([vendorId, createdAt(sort: Desc)], name: "promotion_events_vendor_idx")
  @@index([promotionType, promotionId, event], name: "promotion_events_promotion_created_idx")
  @@map("promotion_events")
}`);


addEnumValues("PartnerStatus", ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"]);
addEnumValues("EventAudience", ["VENDORS", "CUSTOMERS", "EVERYONE"]);
addEnumValues("EventStatus", ["PENDING_REVIEW", "PUBLISHED", "REJECTED", "CANCELLED"]);
addEnumValues("PartnerEventPlan", ["FREE", "FEATURED", "PREMIUM", "ENTERPRISE"]);


addField("User", "  updatedAt", "partnerProfile Partner?");
addField("User", "  updatedAt", "errorLogs ErrorLog[] @relation(\"ErrorLogUser\")");

addModel(`model Partner {
  id String @id @default(uuid())
  ownerUserId String @unique @map("owner_user_id")
  owner User @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  organizationName String @map("organization_name")
  slug String @unique
  description String?
  logoUrl String? @map("logo_url")
  websiteUrl String? @map("website_url")
  contactEmail String? @map("contact_email")
  contactPhone String? @map("contact_phone")
  status String @default("PENDING")
  eventPlan String @default("FREE") @map("event_plan")
  complimentaryAccess Boolean @default(false) @map("complimentary_access")
  complimentaryAccessExpiresAt DateTime? @map("complimentary_access_expires_at")
  complimentaryAccessReason String? @map("complimentary_access_reason")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  events PartnerEvent[]
  @@index([status])
  @@index([eventPlan])
  @@map("partners")
}`);

addModel(`model PartnerEvent {
  id String @id @default(uuid())
  partnerId String @map("partner_id")
  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  title String
  slug String @unique
  description String
  coverImageUrl String? @map("cover_image_url")
  audience String @default("EVERYONE")
  status String @default("PENDING_REVIEW")
  eventPlan String @default("FREE") @map("event_plan")
  startsAt DateTime @map("starts_at")
  endsAt DateTime? @map("ends_at")
  registrationDeadline DateTime? @map("registration_deadline")
  eventType String @default("Virtual") @map("event_type")
  location String?
  registrationUrl String? @map("registration_url")
  organizerName String? @map("organizer_name")
  organizerEmail String? @map("organizer_email")
  organizerPhone String? @map("organizer_phone")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  publishedAt DateTime? @map("published_at")
  @@index([partnerId])
  @@index([status])
  @@index([audience])
  @@index([startsAt])
  @@map("partner_events")
}`);


addModel(`model ErrorLog {
  id String @id
  referenceCode String @unique(map: "error_logs_reference_code_idx") @map("reference_code")
  severity String @default("ERROR")
  httpStatus Int @map("http_status")
  errorCode String @map("error_code")
  message String
  explanation String
  method String
  path String
  userId String? @map("user_id")
  user User? @relation("ErrorLogUser", fields: [userId], references: [id], onDelete: SetNull)
  orderId String? @map("order_id")
  orderNumber String? @map("order_number")
  productId String? @map("product_id")
  productName String? @map("product_name")
  vendorId String? @map("vendor_id")
  vendorName String? @map("vendor_name")
  metadata Json?
  stack String?
  ipAddress String? @map("ip_address")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([errorCode])
  @@index([orderNumber])
  @@index([productId])
  @@index([userId])
  @@index([createdAt])
  @@map("error_logs")
}`);

fs.writeFileSync(schemaPath, schema);
console.log("TTFL Prisma schema prepared for current backend modules.");

