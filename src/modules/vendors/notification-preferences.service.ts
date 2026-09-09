import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getVendorProfileForUser } from "@/lib/vendor-access";

export type VendorNotificationPreferences = {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  marketingEnabled: boolean;
};

const defaults: VendorNotificationPreferences = {
  emailEnabled: true,
  whatsappEnabled: true,
  marketingEnabled: false,
};

export async function getPreferences(userId: string): Promise<VendorNotificationPreferences> {
  const vendor = await getVendorProfileForUser(userId);
  const rows = await prisma.$queryRawUnsafe<Array<{
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    marketingEnabled: boolean;
  }>>(
    `SELECT email_enabled AS "emailEnabled", whatsapp_enabled AS "whatsappEnabled", marketing_enabled AS "marketingEnabled"
     FROM vendor_notification_preferences WHERE vendor_id=$1 LIMIT 1`,
    vendor.id,
  );
  return rows[0] ?? defaults;
}

export async function updatePreferences(
  userId: string,
  input: Partial<VendorNotificationPreferences>,
): Promise<VendorNotificationPreferences> {
  const vendor = await getVendorProfileForUser(userId);
  const current = await getPreferences(userId);
  const value = { ...current, ...input };

  await prisma.$executeRawUnsafe(
    `INSERT INTO vendor_notification_preferences
      (id,vendor_id,email_enabled,whatsapp_enabled,marketing_enabled,updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (vendor_id) DO UPDATE SET
       email_enabled=EXCLUDED.email_enabled,
       whatsapp_enabled=EXCLUDED.whatsapp_enabled,
       marketing_enabled=EXCLUDED.marketing_enabled,
       updated_at=NOW()`,
    randomUUID(),
    vendor.id,
    value.emailEnabled,
    value.whatsappEnabled,
    value.marketingEnabled,
  );

  return value;
}
