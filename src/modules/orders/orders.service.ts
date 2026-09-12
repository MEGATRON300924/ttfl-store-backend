import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { createTransactionSplit, initializeTransaction, verifyTransaction, refundTransaction } from "@/lib/paystack";
import { resolveCommissionRate, calculateCommission } from "@/lib/commissions";
import { validateCoupon, recordRedemption, type CartLineForCoupon } from "@/modules/coupons/coupons.service";
import { getCheckoutDeals } from "@/modules/flash-deals/flash-deals.service";
import { sendEmail, orderConfirmationEmail, vendorNewOrderEmail, adminNewOrderEmail, orderRefundedEmail } from "@/lib/email";
import { sendWhatsAppNotification, newOrderWhatsAppMessage } from "@/lib/whatsapp-notifications";
import { recordAudit } from "@/lib/audit";
import { recordPurchase, reversePurchase } from "@/modules/rewards/rewards.service";
import { recordConversionEvent } from "@/modules/ads/ads.service";
import { logger } from "@/lib/logger";
import type { CheckoutInput } from "./orders.validators";
import type { Prisma, OrderStatus, Product } from "@prisma/client";

async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  let orderNumber: string;
  do {
    orderNumber = `TTFL-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
  } while (await prisma.order.findUnique({ where: { orderNumber } }));
  return orderNumber;
}

/**
 * Paystack's server-side Transaction API expects a split_code for multi-split
 * payments. The previous implementation sent an inline `split` object to
 * transaction/initialize, which is not the documented server API shape.
 *
 * We create a flat transaction split only when every vendor has a valid
 * Paystack subaccount. If payout configuration is incomplete, checkout falls
 * back to the main TTFL account so a vendor payout configuration issue can
 * never block a customer's payment.
 */
async function createOrderSplitCode(order: {
  orderNumber: string;
  totalAmount: unknown;
  vendorOrders: Array<{ vendorId: string; vendorEarnings: unknown }>;
}): Promise<string | undefined> {
  if (order.vendorOrders.length === 0) return undefined;

  const vendorIds = order.vendorOrders.map((item) => item.vendorId);
  const vendors = await prisma.vendorProfile.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, storeName: true, paystackSubaccountCode: true, paystackSubaccountActive: true },
  });
  const byVendorId = new Map(vendors.map((vendor) => [vendor.id, vendor]));

  const missing = order.vendorOrders.find((item) => {
    const vendor = byVendorId.get(item.vendorId);
    return !vendor?.paystackSubaccountCode || vendor.paystackSubaccountActive === false;
  });
  if (missing) {
    const vendor = byVendorId.get(missing.vendorId);
    logger.warn("Skipping Paystack split because a vendor payout account is not active", {
      orderNumber: order.orderNumber,
      vendor: vendor?.storeName ?? missing.vendorId,
    });
    return undefined;
  }

  const totalKobo = Math.round(Number(order.totalAmount) * 100);
  if (!Number.isFinite(totalKobo) || totalKobo <= 0) return undefined;

  const shares = order.vendorOrders
    .map((item) => ({
      subaccount: byVendorId.get(item.vendorId)!.paystackSubaccountCode!,
      share: Math.max(0, Math.round(Number(item.vendorEarnings) * 100)),
    }))
    .filter((item) => item.share > 0);

  if (!shares.length) return undefined;

  // Never allow vendor shares to exceed the actual customer payment.
  const requestedShareTotal = shares.reduce((sum, item) => sum + item.share, 0);
  if (requestedShareTotal > totalKobo) {
    const scale = totalKobo / requestedShareTotal;
    for (const item of shares) item.share = Math.floor(item.share * scale);
  }

  const finalShares = shares.filter((item) => item.share > 0);
  if (!finalShares.length) return undefined;

  try {
    return await createTransactionSplit({
      name: `TTFL ${order.orderNumber}`,
      type: "flat",
      bearerType: "account",
      subaccounts: finalShares,
    });
  } catch (error) {
    logger.warn("Paystack split creation failed; continuing checkout without split", {
      orderNumber: order.orderNumber,
      error,
    });
    return undefined;
  }
}

export async function checkout(customerId: string, customerEmail: string, input: CheckoutInput) {
  const productIds = input.items.map((i) => i.productId);
  const products: Product[] = await prisma.product.findMany({ where: { id: { in: productIds }, deletedAt: null } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const deals = await getCheckoutDeals(productIds);
  const groups = new Map<string, { items: { product: Product; quantity: number; unitPrice: number }[] }>();
  for (const line of input.items) {
    const p = byId.get(line.productId);
    if (!p) throw AppError.badRequest(`Product ${line.productId} is no longer available`, "PRODUCT_UNAVAILABLE");
    if (p.status !== "ACTIVE" || p.comingSoon) throw AppError.badRequest(`"${p.name}" is not currently available`, "PRODUCT_UNAVAILABLE");
    if (p.sellingMethod !== "CHECKOUT") throw AppError.badRequest(`"${p.name}" is sold outside TTFL Store checkout — use the vendor's link/WhatsApp instead`, "WRONG_SELLING_METHOD");
    const d = deals.get(p.id);
    if (p.stock < line.quantity) throw AppError.badRequest(`Not enough stock for "${p.name}"`, "INSUFFICIENT_STOCK");
    if (d && d.quantityCap !== null && d.soldCount + line.quantity > d.quantityCap) throw AppError.badRequest(`The Flash Deal for "${p.name}" has reached its remaining quantity`, "FLASH_DEAL_CAP_REACHED");
    const g = groups.get(p.vendorId) ?? { items: [] };
    g.items.push({ product: p, quantity: line.quantity, unitPrice: d?.salePrice ?? Number(p.price) });
    groups.set(p.vendorId, g);
  }

  let subtotalAmount = 0;
  const vendorOrderData: Prisma.VendorOrderCreateWithoutOrderInput[] = [];
  const vendorSubtotals = new Map<string, number>();
  const couponLines: CartLineForCoupon[] = [];

  for (const [vendorId, g] of groups) {
    const subtotal = g.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    vendorSubtotals.set(vendorId, subtotal);
    subtotalAmount += subtotal;
    for (const i of g.items) couponLines.push({ vendorId, categoryId: i.product.categoryId, lineTotal: i.unitPrice * i.quantity });
  }

  let discountAmount = 0;
  let couponId: string | null = null;
  let couponCode: string | null = null;
  let couponVendorId: string | null = null;
  let couponCategoryId: string | null = null;
  let couponEligibleBase = 0;

  if (input.couponCode) {
    const result = await validateCoupon(input.couponCode, customerId, couponLines);
    discountAmount = result.discountAmount;
    couponId = result.coupon.id;
    couponCode = result.coupon.code;
    couponEligibleBase = result.eligibleBase;
    const coupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    couponVendorId = coupon.vendorId;
    couponCategoryId = coupon.categoryId;
  }

  const totalAmount = Math.max(0, Math.round((subtotalAmount - discountAmount) * 100) / 100);

  // Allocate the coupon discount only across the vendor/category lines the
  // coupon actually applies to. This keeps vendor earnings aligned with the
  // amount the customer is actually paying and prevents split shares from
  // exceeding the transaction total.
  for (const [vendorId, g] of groups) {
    const originalSubtotal = g.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    if (!discountAmount || !couponEligibleBase) {
      vendorSubtotals.set(vendorId, originalSubtotal);
      continue;
    }

    const eligibleForVendor = couponLines
      .filter((line) => line.vendorId === vendorId)
      .filter((line) => !couponVendorId || line.vendorId === couponVendorId)
      .filter((line) => !couponCategoryId || line.categoryId === couponCategoryId)
      .reduce((sum, line) => sum + line.lineTotal, 0);

    const allocation = couponVendorId || couponCategoryId
      ? discountAmount * (eligibleForVendor / couponEligibleBase)
      : discountAmount * (originalSubtotal / subtotalAmount);

    vendorSubtotals.set(vendorId, Math.max(0, Math.round((originalSubtotal - allocation) * 100) / 100));
  }

  // Correct any cent-level rounding drift so the vendor subtotals add up to
  // exactly the amount the customer is being charged.
  const calculatedVendorSubtotal = Array.from(vendorSubtotals.values()).reduce((sum, value) => sum + value, 0);
  const subtotalDrift = Math.round((totalAmount - calculatedVendorSubtotal) * 100) / 100;
  if (groups.size && Math.abs(subtotalDrift) >= 0.01) {
    const firstVendorId = groups.keys().next().value as string;
    vendorSubtotals.set(firstVendorId, Math.max(0, Math.round(((vendorSubtotals.get(firstVendorId) ?? 0) + subtotalDrift) * 100) / 100));
  }

  for (const [vendorId, g] of groups) {
    const subtotal = vendorSubtotals.get(vendorId)!;
    const rate = await resolveCommissionRate(vendorId);
    const { commissionAmount, vendorEarnings } = calculateCommission(subtotal, rate);
    vendorOrderData.push({
      vendor: { connect: { id: vendorId } },
      subtotal,
      commissionRate: rate,
      commissionAmount,
      vendorEarnings,
      items: { create: g.items.map((i) => ({ productId: i.product.id, productName: i.product.name, unitPrice: i.unitPrice, quantity: i.quantity, lineTotal: i.unitPrice * i.quantity })) },
    });
  }

  const orderNumber = await generateOrderNumber();
  const paymentReference = `ttfl_${orderNumber}_${Date.now()}`;
  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId,
      totalAmount,
      subtotalAmount,
      discountAmount,
      couponCode,
      paymentReference,
      deliveryName: input.delivery.name,
      deliveryPhone: input.delivery.phone,
      deliveryLine1: input.delivery.line1,
      deliveryLine2: input.delivery.line2,
      deliveryCity: input.delivery.city,
      deliveryState: input.delivery.state,
      deliveryCountry: input.delivery.country,
      vendorOrders: { create: vendorOrderData },
    },
    include: { vendorOrders: { include: { items: true } } },
  });

  if (couponId) await recordRedemption(couponId, customerId, order.id, discountAmount);

  const splitCode = await createOrderSplitCode(order);
  const paystack = await initializeTransaction({
    email: customerEmail,
    amountNaira: totalAmount,
    reference: paymentReference,
    callbackUrl: `${env.appUrl}/orders/${order.orderNumber}/confirm`,
    metadata: { orderId: order.id, orderNumber: order.orderNumber, ...(input.adCampaignId ? { adCampaignId: input.adCampaignId } : {}) },
    splitCode,
  });

  if (input.adCampaignId) void recordConversionEvent(input.adCampaignId, "PURCHASE", { stage: "CHECKOUT_START", orderId: order.id }).catch(() => undefined);
  return { order, checkoutUrl: paystack.authorization_url };
}

export async function verifyAndFinalizePayment(reference: string) {
  const order = await prisma.order.findUnique({ where: { paymentReference: reference }, include: { vendorOrders: { include: { items: true } } } });
  if (!order) throw AppError.notFound("Order not found for this payment reference");
  if (order.paymentStatus === "PAID") return order;
  const verification = await verifyTransaction(reference);

  if (["ongoing", "pending", "processing", "queued"].includes(verification.status)) return order;

  if (verification.status !== "success") {
    await prisma.$transaction([
      prisma.payment.upsert({ where: { reference }, create: { orderId: order.id, reference, amount: order.totalAmount, status: "FAILED", gatewayResponse: verification as unknown as Prisma.InputJsonValue }, update: { status: "FAILED", gatewayResponse: verification as unknown as Prisma.InputJsonValue } }),
      prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "FAILED" } }),
    ]);
    throw AppError.badRequest("Payment was not successful", "PAYMENT_FAILED");
  }
  if (verification.currency !== "NGN") throw AppError.badRequest("Payment currency does not match this order", "CURRENCY_MISMATCH");

  const requestedAmountKobo = verification.requested_amount ?? verification.amount;
  const requestedAmountNaira = requestedAmountKobo / 100;
  if (Math.round(requestedAmountNaira * 100) !== Math.round(Number(order.totalAmount) * 100)) {
    throw AppError.badRequest("Payment amount does not match order total", "AMOUNT_MISMATCH");
  }

  let alreadyFinalized = false;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reference}))`;
    const current = await tx.order.findUnique({ where: { id: order.id }, select: { paymentStatus: true } });
    if (current?.paymentStatus === "PAID") {
      alreadyFinalized = true;
      return;
    }

    await tx.payment.upsert({ where: { reference }, create: { orderId: order.id, reference, amount: requestedAmountNaira, status: "PAID", channel: verification.channel, gatewayResponse: verification as unknown as Prisma.InputJsonValue }, update: { status: "PAID", amount: requestedAmountNaira, channel: verification.channel, gatewayResponse: verification as unknown as Prisma.InputJsonValue } });
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID", paidAt: new Date() } });
    await tx.vendorOrder.updateMany({ where: { orderId: order.id }, data: { status: "PROCESSING" } });
    for (const vo of order.vendorOrders) for (const item of vo.items) {
      const updated = await tx.product.updateMany({ where: { id: item.productId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
      if (updated.count !== 1) throw AppError.badRequest(`Not enough stock for "${item.productName}"`, "INSUFFICIENT_STOCK");
    }
    for (const item of order.vendorOrders.flatMap((vo) => vo.items)) await tx.$executeRawUnsafe(`UPDATE flash_deals fd SET sold_count=(SELECT COALESCE(SUM(oi.quantity),0)::int FROM order_items oi JOIN vendor_orders vo ON vo.id=oi.vendor_order_id JOIN orders o ON o.id=vo.order_id WHERE oi.product_id=fd.product_id AND o.payment_status='PAID') WHERE fd.product_id=$1 AND fd.active=true`, item.productId);
  });

  if (alreadyFinalized) return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } });

  const metadata = (verification as any)?.metadata;
  const adCampaignId = typeof metadata?.adCampaignId === "string" ? metadata.adCampaignId : undefined;
  if (adCampaignId) void recordConversionEvent(adCampaignId, "PURCHASE", { orderId: order.id, orderNumber: order.orderNumber, amount: Number(order.totalAmount), stage: "PAID" }).catch(() => undefined);
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) { void sendEmail({ to: customer.email, ...orderConfirmationEmail(order.orderNumber) }); void recordPurchase(customer.id, order.id, Number(order.totalAmount)).catch(() => undefined); }
  for (const vo of order.vendorOrders) { const vendor = await prisma.vendorProfile.findUnique({ where: { id: vo.vendorId }, include: { user: true } }); if (vendor) void sendEmail({ to: vendor.user.email, ...vendorNewOrderEmail(order.orderNumber, vo.items.length) }); }
  if (env.adminNotificationEmail) void sendEmail({ to: env.adminNotificationEmail, ...adminNewOrderEmail(order.orderNumber, Number(order.totalAmount)) });
  if (env.whatsapp.adminNumber) void sendWhatsAppNotification({ to: env.whatsapp.adminNumber, message: newOrderWhatsAppMessage(order.orderNumber, Number(order.totalAmount)), event: "admin_new_order" });
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } });
}

export async function getMyOrders(customerId: string) { return prisma.order.findMany({ where: { customerId }, include: { vendorOrders: { include: { items: true } } }, orderBy: { createdAt: "desc" } }); }
export async function getOrderByNumber(orderNumber: string, requesterId: string, requesterRole: string) { const order = await prisma.order.findUnique({ where: { orderNumber }, include: { vendorOrders: { include: { items: true, vendor: true } } } }); if (!order) throw AppError.notFound("Order not found"); const isOwner = order.customerId === requesterId; const isVendorOnOrder = order.vendorOrders.some((vo) => vo.vendor.userId === requesterId); if (!isOwner && !isVendorOnOrder && requesterRole !== "ADMIN") throw AppError.forbidden("You don't have access to this order"); return order; }
export async function getMyVendorOrders(userId: string) { const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId } }); return prisma.vendorOrder.findMany({ where: { vendorId: vendor.id }, include: { items: true, order: true }, orderBy: { createdAt: "desc" } }); }
const FORWARD_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = { PENDING: ["PROCESSING", "CANCELLED"], PROCESSING: ["SHIPPED", "CANCELLED"], SHIPPED: ["OUT_FOR_DELIVERY"], OUT_FOR_DELIVERY: ["DELIVERED"], DELIVERED: [], CANCELLED: [], REFUND_REQUESTED: ["REFUNDED"], REFUNDED: [], FAILED: [] };
export async function updateVendorOrderStatus(userId: string, vendorOrderId: string, nextStatus: OrderStatus) { const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId } }); const vo = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId } }); if (!vo || vo.vendorId !== vendor.id) throw AppError.notFound("Order not found"); if (!FORWARD_TRANSITIONS[vo.status].includes(nextStatus)) throw AppError.badRequest(`Can't move an order from ${vo.status} to ${nextStatus}`, "INVALID_STATUS_TRANSITION"); return prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: nextStatus } }); }
export async function refundOrder(orderId: string, adminId: string) { const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vendorOrders: { include: { items: true } } } }); if (!order) throw AppError.notFound("Order not found"); if (order.paymentStatus !== "PAID") throw AppError.badRequest("Only paid orders can be refunded", "ORDER_NOT_PAID"); await refundTransaction(order.paymentReference, Number(order.totalAmount)); await prisma.$transaction(async (tx) => { await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "REFUNDED" } }); await tx.vendorOrder.updateMany({ where: { orderId: order.id }, data: { status: "REFUNDED" } }); for (const vo of order.vendorOrders) for (const item of vo.items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } }); }); void reversePurchase(order.id).catch(() => undefined); const customer = await prisma.user.findUnique({ where: { id: order.customerId } }); if (customer) void sendEmail({ to: customer.email, ...orderRefundedEmail(order.orderNumber) }); await recordAudit({ actorId: adminId, action: "ORDER_REFUNDED", targetType: "Order", targetId: order.id }); return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } }); }
export async function adminListOrders(page: number, limit: number, paymentStatus?: string) { const where = paymentStatus ? { paymentStatus: paymentStatus as never } : {}; const [items, total] = await prisma.$transaction([prisma.order.findMany({ where, include: { customer: { select: { firstName: true, lastName: true, email: true } }, vendorOrders: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }), prisma.order.count({ where })]); return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } }; }
