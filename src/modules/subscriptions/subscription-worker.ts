import { prisma } from "@/lib/prisma";
import { getPlanForTier } from "@/modules/vendor-plans/vendor-plans.service";
import { ensureGiftedSubscriptionSchema } from "./gifted-subscription-schema";
import { logger } from "@/lib/logger";

const INTERVAL_MS = 60 * 60 * 1000;

export async function expireCancelledSubscriptions() {
  await ensureGiftedSubscriptionSchema();
  const freePlan = await getPlanForTier("FREE");
  const expired = await prisma.vendorSubscription.findMany({
    where: {
      renewalDate: { lte: new Date() },
      OR: [{ status: "CANCELLED" }, { isGifted: true }],
    },
    select: { id: true, vendorId: true, isGifted: true },
  });

  for (const subscription of expired) {
    await prisma.$transaction([
      prisma.vendorSubscription.update({ where: { id: subscription.id }, data: { status: "EXPIRED", isGifted: false } }),
      prisma.vendorProfile.update({ where: { id: subscription.vendorId }, data: { tier: freePlan.tier } }),
    ]);
  }

  if (expired.length > 0) logger.info(`Expired ${expired.length} cancelled or gifted vendor subscription(s)`);
}

export function startSubscriptionWorker() {
  void expireCancelledSubscriptions().catch((error) => logger.error("Initial subscription expiry check failed", error));
  setInterval(() => {
    void expireCancelledSubscriptions().catch((error) => logger.error("Subscription expiry check failed", error));
  }, INTERVAL_MS).unref();
}
