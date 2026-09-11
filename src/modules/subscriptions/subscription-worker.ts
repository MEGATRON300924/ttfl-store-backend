import { prisma } from "@/lib/prisma";
import { getPlanForTier } from "@/modules/vendor-plans/vendor-plans.service";
import { logger } from "@/lib/logger";

const INTERVAL_MS = 15 * 60 * 1000;

export async function expireCancelledSubscriptions() {
  const freePlan = await getPlanForTier("FREE");
  const expired = await prisma.vendorSubscription.findMany({
    where: {
      status: "CANCELLED",
      renewalDate: { lte: new Date() },
    },
    select: { id: true, vendorId: true },
  });

  for (const subscription of expired) {
    await prisma.$transaction([
      prisma.vendorSubscription.update({
        where: { id: subscription.id },
        data: { status: "EXPIRED" },
      }),
      prisma.vendorProfile.update({
        where: { id: subscription.vendorId },
        data: { tier: freePlan.tier },
      }),
    ]);
  }

  if (expired.length > 0) {
    logger.info(`Expired ${expired.length} cancelled vendor subscription(s)`);
  }
}

export function startSubscriptionWorker() {
  void expireCancelledSubscriptions().catch((error) => logger.error("Initial subscription expiry check failed", error));
  setInterval(() => {
    void expireCancelledSubscriptions().catch((error) => logger.error("Subscription expiry check failed", error));
  }, INTERVAL_MS);
}
