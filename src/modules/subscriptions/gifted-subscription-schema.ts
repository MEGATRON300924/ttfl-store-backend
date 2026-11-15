import { prisma } from "@/lib/prisma";

let schemaReady: Promise<void> | null = null;

/** Add the gift marker and recover prior admin gifts from their audit records. */
export async function ensureGiftedSubscriptionSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS "isGifted" BOOLEAN NOT NULL DEFAULT FALSE',
      );
      // Older admin gifts were stored as ACTIVE subscriptions, so the old worker could
      // not distinguish them from paid renewals. Backfill all paid-tier admin grants.
      await prisma.$executeRawUnsafe(`
        UPDATE vendor_subscriptions AS vs
        SET "isGifted" = TRUE
        FROM audit_logs AS al
        JOIN vendor_plans AS vp ON vp.id = vs."planId"
        WHERE al."targetType" = 'VendorSubscription'
          AND al."targetId" = vs.id
          AND al.action = 'VENDOR_TIER_CHANGED'
          AND al.metadata ->> 'adminGranted' = 'true'
          AND vp.price > 0
          AND vs."isGifted" = FALSE
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}
