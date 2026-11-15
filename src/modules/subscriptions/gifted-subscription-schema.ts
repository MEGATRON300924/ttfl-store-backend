import { prisma } from "@/lib/prisma";

let schemaReady: Promise<void> | null = null;

/** Keep production databases compatible before Prisma reads/writes the gifted-plan flag. */
export async function ensureGiftedSubscriptionSchema() {
  if (!schemaReady) {
    schemaReady = prisma.$executeRawUnsafe(
      'ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS "isGifted" BOOLEAN NOT NULL DEFAULT FALSE',
    ).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}
