import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { initializeTransaction, verifyTransaction } from "@/lib/paystack";
import { recordAudit } from "@/lib/audit";
import { getPlanForTier } from "@/modules/vendor-plans/vendor-plans.service";
import type { VendorTier } from "@prisma/client";

function addBillingPeriod(date: Date, period: "MONTHLY" | "YEARLY"): Date {
  const next = new Date(date);
  if (period === "MONTHLY") next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

async function expireIfNeeded(vendorId: string) {
  const subscription = await prisma.vendorSubscription.findUnique({
    where: { vendorId },
    include: { plan: true },
  });

  if (
    subscription?.status === "CANCELLED" &&
    subscription.renewalDate &&
    subscription.renewalDate <= new Date()
  ) {
    const freePlan = await getPlanForTier("FREE");
    await prisma.$transaction([
      prisma.vendorSubscription.update({
        where: { id: subscription.id },
        data: { status: "EXPIRED" },
      }),
      prisma.vendorProfile.update({
        where: { id: vendorId },
        data: { tier: freePlan.tier },
      }),
    ]);
  }
}

export async function getMySubscription(vendorId: string) {
  await expireIfNeeded(vendorId);
  return prisma.vendorSubscription.findUnique({
    where: { vendorId },
    include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
}

/**
 * Starts (or changes) a subscription. FREE has no charge — it activates
 * immediately. Paid tiers require a Paystack payment first; the
 * subscription only flips to that plan once verifyAndActivate confirms
 * payment, mirroring how order payments work (never trust the frontend).
 */
export async function initiatePlanChange(
  vendorId: string,
  vendorEmail: string,
  targetTier: VendorTier
) {
  await expireIfNeeded(vendorId);
  const plan = await getPlanForTier(targetTier);

  if (Number(plan.price) === 0) {
    const subscription = await prisma.vendorSubscription.upsert({
      where: { vendorId },
      create: { vendorId, planId: plan.id, status: "ACTIVE" },
      update: { planId: plan.id, status: "ACTIVE", renewalDate: null, cancelledAt: null },
    });
    await prisma.vendorProfile.update({ where: { id: vendorId }, data: { tier: targetTier } });
    return { subscription, checkoutUrl: null };
  }

  const reference = `ttfl_sub_${vendorId}_${Date.now()}`;
  const paystack = await initializeTransaction({
    email: vendorEmail,
    amountNaira: Number(plan.price),
    reference,
    callbackUrl: `${env.appUrl}/vendor/dashboard/subscription/confirm`,
    metadata: { vendorId, targetTier, kind: "subscription" },
  });

  // Subscription row starts PAST_DUE (pending first payment). A previously
  // cancelled subscription is not downgraded until its paid period ends;
  // paying again reactivates it normally after verification.
  const subscription = await prisma.vendorSubscription.upsert({
    where: { vendorId },
    create: { vendorId, planId: plan.id, status: "PAST_DUE" },
    update: { planId: plan.id, status: "PAST_DUE", cancelledAt: null },
  });

  await prisma.subscriptionPayment.create({
    data: { subscriptionId: subscription.id, reference, amount: plan.price, status: "PENDING" },
  });

  return { subscription, checkoutUrl: paystack.authorization_url };
}

/** Idempotent, same pattern as orders.verifyAndFinalizePayment. */
export async function verifyAndActivateSubscription(reference: string) {
  const payment = await prisma.subscriptionPayment.findUnique({
    where: { reference },
    include: { subscription: { include: { plan: true, vendor: true } } },
  });
  if (!payment) throw AppError.notFound("Subscription payment not found");
  if (payment.status === "PAID") return payment.subscription;

  const verification = await verifyTransaction(reference);
  if (verification.status !== "success") {
    await prisma.subscriptionPayment.update({ where: { reference }, data: { status: "FAILED" } });
    throw AppError.badRequest("Payment was not successful", "PAYMENT_FAILED");
  }

  const paidNaira = verification.amount / 100;
  if (Math.round(paidNaira) !== Math.round(Number(payment.amount))) {
    throw AppError.badRequest("Payment amount does not match plan price", "AMOUNT_MISMATCH");
  }

  await prisma.$transaction([
    prisma.subscriptionPayment.update({
      where: { reference },
      data: { status: "PAID", gatewayResponse: verification as unknown as object },
    }),
    prisma.vendorSubscription.update({
      where: { id: payment.subscriptionId },
      data: {
        status: "ACTIVE",
        startDate: new Date(),
        renewalDate: addBillingPeriod(new Date(), payment.subscription.plan.billingPeriod),
        cancelledAt: null,
      },
    }),
    prisma.vendorProfile.update({
      where: { id: payment.subscription.vendorId },
      data: { tier: payment.subscription.plan.tier },
    }),
  ]);

  return prisma.vendorSubscription.findUniqueOrThrow({
    where: { id: payment.subscriptionId },
    include: { plan: true },
  });
}

export async function cancelSubscription(vendorId: string) {
  await expireIfNeeded(vendorId);
  const subscription = await prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } });
  if (!subscription) throw AppError.notFound("Subscription not found");
  if (subscription.plan.tier === "FREE") throw AppError.badRequest("You are already on the Free plan", "ALREADY_FREE");
  if (subscription.status === "CANCELLED") {
    return { subscription, cancellationScheduledFor: subscription.renewalDate };
  }

  // Cancellation is scheduled for the end of the paid period. The vendor
  // keeps the paid plan and all of its benefits until renewalDate.
  const cancelledAt = new Date();
  const updated = await prisma.vendorSubscription.update({
    where: { vendorId },
    data: { status: "CANCELLED", cancelledAt },
    include: { plan: true },
  });

  await recordAudit({
    action: "SUBSCRIPTION_CHANGED",
    targetType: "VendorSubscription",
    targetId: updated.id,
    metadata: {
      cancelled: true,
      cancellationScheduledFor: updated.renewalDate,
      planTier: updated.plan.tier,
    },
  });

  return { subscription: updated, cancellationScheduledFor: updated.renewalDate };
}

export async function resumeSubscription(vendorId: string) {
  await expireIfNeeded(vendorId);
  const subscription = await prisma.vendorSubscription.findUnique({
    where: { vendorId },
    include: { plan: true },
  });
  if (!subscription) throw AppError.notFound("Subscription not found");
  if (subscription.status !== "CANCELLED") {
    return { subscription };
  }
  if (!subscription.renewalDate || subscription.renewalDate <= new Date()) {
    throw AppError.badRequest("This subscription has already expired", "SUBSCRIPTION_EXPIRED");
  }

  const updated = await prisma.vendorSubscription.update({
    where: { vendorId },
    data: { status: "ACTIVE", cancelledAt: null },
    include: { plan: true },
  });

  await recordAudit({
    action: "SUBSCRIPTION_CHANGED",
    targetType: "VendorSubscription",
    targetId: updated.id,
    metadata: { cancellationReversed: true, planTier: updated.plan.tier },
  });

  return { subscription: updated };
}
