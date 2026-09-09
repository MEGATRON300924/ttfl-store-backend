import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getVendorProfileForUser } from "@/lib/vendor-access";

export async function getPreferences(userId: string) {
  const vendor = await getVendorProfileForUser(userId);
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT vendor_id AS "vendorId", email_enabled AS "emailEnabled", whatsapp_enabled AS "whatsappEnabled", marketing_enabled AS "marketingEnabled" FROM vendor_notification_preferences WHERE vendor_id=$1 LIMIT 1`, vendor.id);
  return rows[0] ?? { vendorId: vendor.id, emailEnabled: true, whatsappEnabled: true, marketingEnabled: false };
}
export async function updatePreferences(userId: string, input: { emailEnabled?: boolean; whatsappEnabled?: boolean; marketingEnabled?: boolean }) {
  const vendor = await getVendorProfileForUser(userId);
  const current = await getPreferences(userId);
  await prisma.$executeRawUnsafe(`INSERT INTO vendor_notification_preferences (id,vendor_id,email_enabled,whatsapp_enabled,marketing_enabled) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (vendor_id) DO UPDATE SET email_enabled=$3, whatsapp_enabled=$4, marketing_enabled=$5, updated_at=NOW()`, randomUUID(), vendor.id, input.emailEnabled ?? current.emailEnabled, input.whatsappEnabled ?? current.whatsappEnabled, input.marketingEnabled ?? current.marketingEnabled);
  return getPreferences(userId);
}
