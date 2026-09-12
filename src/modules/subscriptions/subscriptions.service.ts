import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import {
  disableSubscription,
  getCustomer,
  getOrCreateMonthlyPlan,
  initializeTransaction,
  verifyTransaction,
} from "@/lib/paystack";
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
 * Starts (or changes) a vendor plan. Paid plans use a Paystack recurring plan.
 * Paystack subscriptions currently support card and Nigerian direct debit, so
 * the first checkout is intentionally card-only to avoid accepting a transfer
 * that cannot create a recurring subscription.
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

  const recurringPlan = await getOrCreateMonthlyPlan({
    tier: targetTier,
    amountNaira: Number(plan.price),
  });

  const reference = `ttfl_sub_${vendorId}_${Date.now()}`;
  const paystack = await initializeTransaction({
    email: vendorEmail,
    amountNaira: Number(plan.price),
    reference,
    callbackUrl: `${env.appUrl}/vendor/dashboard/subscription/confirm`,
    metadata: { vendorId, targetTier, kind: "subscription", planCode: recurringPlan.plan_code },
    plan: recurringPlan.plan_code,
    channels: ["card"],
  });

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

/** Idempotent first-payment verification. */
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
  if (Math.round(paidNaira * 100) !== Math.round(Number(payment.amount) * 100)) {
    throw AppError.badRequest("Payment amount does not match plan price", "AMOUNT_MISMATCH");
  }
  if (verification.currency !== "NGN") {
    throw AppError.badRequest("Payment currency does not match plan currency", "CURRENCY_MISMATCH");
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.subscriptionPayment.update({
      where: { reference },
      data: { status: "PAID", gatewayResponse: verification as unknown as object },
    }),
    prisma.vendorSubscription.update({
      where: { id: payment.subscriptionId },
      data: {
        status: "ACTIVE",
        startDate: now,
        renewalDate: addBillingPeriod(now, payment.subscription.plan.billingPeriod),
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

/**
 * Handles Paystack's recurring subscription webhooks. Paystack sends a new
 * charge.success for each successful billing cycle and invoice.payment_failed
 * when a recurring charge fails. We identify the local vendor from the
 * Paystack customer email and require the event to contain subscription/plan
 * context before treating it as a recurring vendor-plan payment.
 */
export async function handlePaystackSubscriptionEvent(event: string, data: any) {
  const email = data?.customer?.email ?? data?.email;
  if (!email || typeof email !== "string") return false;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return false;
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!vendor) return false;

  const local = await prisma.vendorSubscription.findUnique({
    where: { vendorId: vendor.id },
    include: { plan: true },
  });
  if (!local || local.plan.tier === "FREE") return false;

  const hasSubscriptionContext = Boolean(
    data?.subscription?.subscription_code ||
    data?.subscription_code ||
    data?.plan?.plan_code ||
    data?.plan_code
  );
  if (!hasSubscriptionContext) return false;

  if (event === "charge.success") {
    const reference = typeof data.reference === "string" ? data.reference : undefined;
    const amountNaira = Number(data.amount ?? 0) / 100;
    if (!reference || !Number.isFinite(amountNaira) || amountNaira <= 0) return false;
    if (Math.round(amountNaira * 100) !== Math.round(Number(local.plan.price) * 100)) return false;
    if (data.currency && data.currency !== "NGN") return false;

    const existing = await prisma.subscriptionPayment.findUnique({ where: { reference } });
    if (!existing) {
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: local.id,
          reference,
          amount: amountNaira,
          status: "PAID",
          gatewayResponse: data as object,
        },
      });
    } else if (existing.status !== "PAID") {
      await prisma.subscriptionPayment.update({
        where: { reference },
        data: { status: "PAID", gatewayResponse: data as object },
      });
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.vendorSubscription.update({
        where: { id: local.id },
        data: {
          status: "ACTIVE",
          renewalDate: addBillingPeriod(now, local.plan.billingPeriod),
          cancelledAt: null,
        },
      }),
      prisma.vendorProfile.update({ where: { id: vendor.id }, data: { tier: local.plan.tier } }),
    ]);
    return true;
  }

  if (event === "invoice.payment_failed") {
    await prisma.vendorSubscription.update({ where: { id: local.id }, data: { status: "PAST_DUE" } });
    return true;
  }

  if (event === "subscription.not_renew") {
    await prisma.vendorSubscription.update({ where: { id: local.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    return true;
  }

  if (event === "subscription.disable") {
    const freePlan = await getPlanForTier("FREE");
    await prisma.$transaction([
      prisma.vendorSubscription.update({ where: { id: local.id }, data: { status: "EXPIRED" } }),
      prisma.vendorProfile.update({ where: { id: vendor.id }, data: { tier: freePlan.tier } }),
    ]);
    return true;
  }

  return false;
}

export async function cancelSubscription(vendorId: string, vendorEmail: string) {
  await expireIfNeeded(vendorId);
  const subscription = await prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } });
  if (!subscription) throw AppError.notFound("Subscription not found");
  if (subscription.plan.tier === "FREE") throw AppError.badRequest("You are already on the Free plan", "ALREADY_FREE");
  if (subscription.status === "CANCELLED") {
    return { subscription, cancellationScheduledFor: subscription.renewalDate };
  }

  // Tell Paystack to stop the recurring charge while keeping local access until
  // the already-paid renewalDate. This uses the customer's active subscription
  // code/token returned by the Customer API, so we don't need extra DB columns.
  try {
    const customer = await getCustomer(vendorEmail);
    const remote = customer.subscriptions?.find((item) => {
      const amount = Number(item.amount ?? 0);
      return item.status === "active" && Math.round(amount) === Math.round(Number(subscription.plan.price) * 100);
    });
    if (remote?.subscription_code && remote.email_token) {
      await disableSubscription(remote.subscription_code, remote.email_token);
    }
  } catch (error) {
    // Do not silently mark a subscription cancelled if Paystack could not be
    // reached; otherwise the customer could still be charged remotely.
    throw AppError.internal("We could not cancel the recurring Paystack subscription. Please try again.", "PAYSTACK_CANCEL_FAILED");
  }

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
