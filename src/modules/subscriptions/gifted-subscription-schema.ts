import { prisma } from "@/lib/prisma";

let schemaReady: Promise<void> | null = null;

/** Add the gift marker and backfill still-running one-month gifts from their admin audit records. */
export async function ensureGiftedSubscriptionSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS "isGifted" BOOLEAN NOT NULL DEFAULT FALSE',
      );
      // Older admin grants were stored as ACTIVE subscriptions, so the old expiry worker
      // could not distinguish them from paid renewals. Their audit metadata is the source
      // of truth for recovering finite gifts that were issued before this flag existed.
      await prisma.$executeRawUnsafe(`
        UPDATE vendor_subscriptions AS vs
        SET "isGifted" = TRUE
        FROM audit_logs AS al
        WHERE al."targetType" = 'VendorSubscription'
          AND al."targetId" = vs.id
          AND al.action = 'VENDOR_TIER_CHANGED'
          AND al.metadata ->> 'adminGranted' = 'true'
          AND al.metadata ->> 'lifetime' = 'false'
          AND vs.status = 'ACTIVE'
          AND vs."renewalDate" IS NOT NULL
          AND vs."isGifted" = FALSE
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}
