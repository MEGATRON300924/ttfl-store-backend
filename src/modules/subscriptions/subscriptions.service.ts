import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { disableSubscription, enableSubscription, getCustomer, getOrCreateMonthlyPlan, initializeTransaction, verifyTransaction } from "@/lib/paystack";
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
  const subscription = await prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } });
  if (subscription?.status === "CANCELLED" && subscription.renewalDate && subscription.renewalDate <= new Date()) {
    const freePlan = await getPlanForTier("FREE");
    await prisma.$transaction([
      prisma.vendorSubscription.update({ where: { id: subscription.id }, data: { status: "EXPIRED" } }),
      prisma.vendorProfile.update({ where: { id: vendorId }, data: { tier: freePlan.tier } }),
    ]);
  }
}

export async function getMySubscription(vendorId: string) {
  await expireIfNeeded(vendorId);
  return prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 20 } } });
}

export async function initiatePlanChange(vendorId: string, vendorEmail: string, targetTier: VendorTier) {
  await expireIfNeeded(vendorId);
  const plan = await getPlanForTier(targetTier);
  if (Number(plan.price) === 0) {
    const subscription = await prisma.vendorSubscription.upsert({ where: { vendorId }, create: { vendorId, planId: plan.id, status: "ACTIVE" }, update: { planId: plan.id, status: "ACTIVE", renewalDate: null, cancelledAt: null } });
    await prisma.vendorProfile.update({ where: { id: vendorId }, data: { tier: targetTier } });
    return { subscription, checkoutUrl: null };
  }
  const recurringPlan = await getOrCreateMonthlyPlan({ tier: targetTier, amountNaira: Number(plan.price) });
  const reference = `ttfl_sub_${vendorId}_${Date.now()}`;
  const paystack = await initializeTransaction({ email: vendorEmail, amountNaira: Number(plan.price), reference, callbackUrl: `${env.appUrl}/vendor/dashboard/subscription/confirm`, metadata: { vendorId, targetTier, kind: "subscription", planCode: recurringPlan.plan_code }, plan: recurringPlan.plan_code, channels: ["card"] });
  const subscription = await prisma.vendorSubscription.upsert({ where: { vendorId }, create: { vendorId, planId: plan.id, status: "PAST_DUE" }, update: { planId: plan.id, status: "PAST_DUE", cancelledAt: null } });
  await prisma.subscriptionPayment.create({ data: { subscriptionId: subscription.id, reference, amount: plan.price, status: "PENDING" } });
  return { subscription, checkoutUrl: paystack.authorization_url };
}

export async function verifyAndActivateSubscription(reference: string) {
  const payment = await prisma.subscriptionPayment.findUnique({ where: { reference }, include: { subscription: { include: { plan: true, vendor: true } } } });
  if (!payment) throw AppError.notFound("Subscription payment not found");
  if (payment.status === "PAID") return payment.subscription;

  const verification = await verifyTransaction(reference);
  if (["ongoing", "pending", "processing", "queued"].includes(verification.status)) return payment.subscription;
  if (verification.status !== "success") {
    await prisma.subscriptionPayment.update({ where: { reference }, data: { status: "FAILED", gatewayResponse: verification as unknown as object } });
    throw AppError.badRequest("Payment was not successful", "PAYMENT_FAILED");
  }
  const paidNaira = verification.amount / 100;
  if (Math.round(paidNaira * 100) !== Math.round(Number(payment.amount) * 100)) throw AppError.badRequest("Payment amount does not match plan price", "AMOUNT_MISMATCH");
  if (verification.currency !== "NGN") throw AppError.badRequest("Payment currency does not match plan currency", "CURRENCY_MISMATCH");

  // Callback verification and charge.success can arrive together. Serialize by
  // payment reference so only one path can activate the subscription.
  let activated = false;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reference}))`;
    const current = await tx.subscriptionPayment.findUnique({ where: { reference }, select: { status: true, subscriptionId: true } });
    if (!current || current.status === "PAID") return;
    const subscription = await tx.vendorSubscription.findUnique({ where: { id: current.subscriptionId }, include: { plan: true } });
    if (!subscription) return;
    const now = new Date();
    await tx.subscriptionPayment.update({ where: { reference }, data: { status: "PAID", gatewayResponse: verification as unknown as object } });
    await tx.vendorSubscription.update({ where: { id: subscription.id }, data: { status: "ACTIVE", startDate: now, renewalDate: addBillingPeriod(now, subscription.plan.billingPeriod), cancelledAt: null } });
    await tx.vendorProfile.update({ where: { id: subscription.vendorId }, data: { tier: subscription.plan.tier } });
    activated = true;
  });

  if (!activated) return prisma.vendorSubscription.findUniqueOrThrow({ where: { id: payment.subscriptionId }, include: { plan: true } });
  return prisma.vendorSubscription.findUniqueOrThrow({ where: { id: payment.subscriptionId }, include: { plan: true } });
}

export async function handlePaystackSubscriptionEvent(event: string, data: any) {
  const email = data?.customer?.email ?? data?.email;
  if (!email || typeof email !== "string") return false;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return false;
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!vendor) return false;
  const local = await prisma.vendorSubscription.findUnique({ where: { vendorId: vendor.id }, include: { plan: true } });
  if (!local || local.plan.tier === "FREE") return false;
  const hasSubscriptionContext = Boolean(data?.subscription?.subscription_code || data?.subscription_code || data?.plan?.plan_code || data?.plan_code);
  if (!hasSubscriptionContext) return false;

  if (event === "charge.success") {
    const reference = typeof data.reference === "string" ? data.reference : undefined;
    const amountNaira = Number(data.amount ?? 0) / 100;
    if (!reference || !Number.isFinite(amountNaira) || amountNaira <= 0) return false;
    if (Math.round(amountNaira * 100) !== Math.round(Number(local.plan.price) * 100)) return false;
    if (data.currency && data.currency !== "NGN") return false;
    const existing = await prisma.subscriptionPayment.findUnique({ where: { reference } });
    if (!existing) await prisma.subscriptionPayment.create({ data: { subscriptionId: local.id, reference, amount: amountNaira, status: "PAID", gatewayResponse: data as object } });
    else if (existing.status !== "PAID") await prisma.subscriptionPayment.update({ where: { reference }, data: { status: "PAID", gatewayResponse: data as object } });
    const now = new Date();
    await prisma.$transaction([
      prisma.vendorSubscription.update({ where: { id: local.id }, data: { status: "ACTIVE", renewalDate: addBillingPeriod(now, local.plan.billingPeriod), cancelledAt: null } }),
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

async function findRemoteSubscription(vendorEmail: string, expectedAmountNaira: number, statuses: string[]) {
  const customer = await getCustomer(vendorEmail);
  return customer.subscriptions?.find((item) => statuses.includes(String(item.status ?? "").toLowerCase()) && Math.round(Number(item.amount ?? 0)) === Math.round(expectedAmountNaira * 100));
}

export async function cancelSubscription(vendorId: string, vendorEmail: string) {
  await expireIfNeeded(vendorId);
  const subscription = await prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } });
  if (!subscription) throw AppError.notFound("Subscription not found");
  if (subscription.plan.tier === "FREE") throw AppError.badRequest("You are already on the Free plan", "ALREADY_FREE");
  if (subscription.status === "CANCELLED") return { subscription, cancellationScheduledFor: subscription.renewalDate };
  try {
    const remote = await findRemoteSubscription(vendorEmail, Number(subscription.plan.price), ["active"]);
    if (remote?.subscription_code && remote.email_token) await disableSubscription(remote.subscription_code, remote.email_token);
    else throw AppError.internal("No active Paystack subscription was found for this vendor.", "PAYSTACK_SUBSCRIPTION_NOT_FOUND");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.internal("We could not cancel the recurring Paystack subscription. Please try again.", "PAYSTACK_CANCEL_FAILED");
  }
  const updated = await prisma.vendorSubscription.update({ where: { vendorId }, data: { status: "CANCELLED", cancelledAt: new Date() }, include: { plan: true } });
  await recordAudit({ action: "SUBSCRIPTION_CHANGED", targetType: "VendorSubscription", targetId: updated.id, metadata: { cancelled: true, cancellationScheduledFor: updated.renewalDate, planTier: updated.plan.tier } });
  return { subscription: updated, cancellationScheduledFor: updated.renewalDate };
}

export async function resumeSubscription(vendorId: string, vendorEmail: string) {
  await expireIfNeeded(vendorId);
  const subscription = await prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } });
  if (!subscription) throw AppError.notFound("Subscription not found");
  if (subscription.status !== "CANCELLED") return { subscription };
  if (!subscription.renewalDate || subscription.renewalDate <= new Date()) throw AppError.badRequest("This subscription has already expired", "SUBSCRIPTION_EXPIRED");
  try {
    const remote = await findRemoteSubscription(vendorEmail, Number(subscription.plan.price), ["non-renewing", "not_renewing", "cancelled", "disabled"]);
    if (!remote?.subscription_code || !remote.email_token) throw AppError.internal("No resumable Paystack subscription was found for this vendor.", "PAYSTACK_SUBSCRIPTION_NOT_FOUND");
    await enableSubscription(remote.subscription_code, remote.email_token);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.internal("We could not resume the recurring Paystack subscription. Please try again.", "PAYSTACK_RESUME_FAILED");
  }
  const updated = await prisma.vendorSubscription.update({ where: { vendorId }, data: { status: "ACTIVE", cancelledAt: null }, include: { plan: true } });
  await recordAudit({ action: "SUBSCRIPTION_CHANGED", targetType: "VendorSubscription", targetId: updated.id, metadata: { cancellationReversed: true, planTier: updated.plan.tier } });
  return { subscription: updated };
}
