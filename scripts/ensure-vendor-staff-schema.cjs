const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

if (!schema.includes("model VendorStaff {")) {
  schema += `

model VendorStaff {
  id          String   @id
  vendorId    String   @map("vendor_id")
  userId      String   @map("user_id")
  role        String
  permissions Json
  active      Boolean  @default(true)
  invitedAt   DateTime @default(now()) @map("invited_at")
  acceptedAt  DateTime? @map("accepted_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @default(now()) @map("updated_at")
  @@unique([vendorId, userId], map: "vendor_staff_vendor_user_unique")
  @@index([userId], map: "vendor_staff_user_idx")
  @@index([vendorId, active], map: "vendor_staff_vendor_active_idx")
  @@map("vendor_staff")
}

model VendorStaffInvitation {
  id          String   @id
  vendorId    String   @map("vendor_id")
  email       String
  role        String
  permissions Json
  tokenHash   String   @unique @map("token_hash")
  expiresAt   DateTime @map("expires_at")
  acceptedAt  DateTime? @map("accepted_at")
  invitedBy   String   @map("invited_by")
  createdAt   DateTime @default(now()) @map("created_at")
  @@index([vendorId, email], map: "vendor_staff_invite_vendor_email_idx")
  @@index([expiresAt], map: "vendor_staff_invite_expires_idx")
  @@map("vendor_staff_invitations")
}
`;
}

fs.writeFileSync(schemaPath, schema);
process.stdout.write("Prisma vendor staff schema prepared.\n");
