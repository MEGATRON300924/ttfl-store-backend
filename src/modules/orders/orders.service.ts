import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { initializeTransaction, verifyTransaction, refundTransaction } from "@/lib/paystack";
import { resolveCommissionRate, calculateCommission } from "@/lib/commissions";
import { validateCoupon, recordRedemption, type CartLineForCoupon } from "@/modules/coupons/coupons.service";
import { sendEmail, orderConfirmationEmail, vendorNewOrderEmail, adminNewOrderEmail, orderRefundedEmail } from "@/lib/email";
import { sendWhatsAppNotification, newOrderWhatsAppMessage } from "@/lib/whatsapp-notifications";
import { recordAudit } from "@/lib/audit";
import type { CheckoutInput } from "./orders.validators";
import type { Prisma, OrderStatus, Product } from "@prisma/client";

async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  let orderNumber: string;
  do {
    const rand = Math.floor(100000 + Math.random() * 900000); // 6 digits
    orderNumber = `TTFL-${year}-${rand}`;
    // eslint-disable-next-line no-await-in-loop
  } while (await prisma.order.findUnique({ where: { orderNumber } }));
  return orderNumber;
}

/**
 * Builds the parent Order + one VendorOrder per vendor in the cart, then
 * hands back a Paystack checkout link. Nothing is charged yet — payment is
 * only confirmed once Paystack calls the webhook (or the frontend calls
 * /verify as a fallback), per spec §20's "never trust the frontend" rule.
 */
export async function checkout(
  customerId: string,
  customerEmail: string,
  input: CheckoutInput
) {
  const productIds = input.items.map((i) => i.productId);
  const products: Product[] = await prisma.product.findMany({
    where: { id: { in: productIds }, deletedAt: null },
  });

  const byId = new Map<string, Product>(products.map((p) => [p.id, p]));
  const vendorGroups = new Map<string, { items: { product: Product; quantity: number }[] }>();

  for (const line of input.items) {
    const product = byId.get(line.productId);
    if (!product) {
      throw AppError.badRequest(`Product ${line.productId} is no longer available`, "PRODUCT_UNAVAILABLE");
    }
    if (product.status !== "ACTIVE") {
      throw AppError.badRequest(`"${product.name}" is not currently available`, "PRODUCT_UNAVAILABLE");
    }
    if (product.sellingMethod !== "CHECKOUT") {
      throw AppError.badRequest(
        `"${product.name}" is sold outside TTFL Store checkout — use the vendor's link/WhatsApp instead`,
        "WRONG_SELLING_METHOD"
      );
    }
    if (product.stock < line.quantity) {
      throw AppError.badRequest(`Not enough stock for "${product.name}"`, "INSUFFICIENT_STOCK");
    }

    const group = vendorGroups.get(product.vendorId) ?? { items: [] };
    group.items.push({ product, quantity: line.quantity });
    vendorGroups.set(product.vendorId, group);
  }

  let totalAmount = 0;
  const vendorOrderData: Prisma.VendorOrderCreateWithoutOrderInput[] = [];
  const vendorSubtotals = new Map<string, number>();
  const cartLinesForCoupon: CartLineForCoupon[] = [];

  for (const [vendorId, group] of vendorGroups) {
    const subtotal = group.items.reduce(
      (sum, i) => sum + Number(i.product.price) * i.quantity,
      0
    );
    vendorSubtotals.set(vendorId, subtotal);
    totalAmount += subtotal;

    for (const i of group.items) {
      cartLinesForCoupon.push({
        vendorId,
        categoryId: i.product.categoryId,
        lineTotal: Number(i.product.price) * i.quantity,
      });
    }
  }

  // Coupon validation happens against the real cart server-side — spec
  // §11 "never trust the frontend discount calculation." If a coupon is
  // vendor-specific, that vendor absorbs the discount (their subtotal and
  // commission shrink); a TTFL-wide coupon is platform-funded and only
  // reduces what the customer pays, leaving vendor payouts untouched.
  let discountAmount = 0;
  let couponId: string | null = null;
  let couponCode: string | null = null;

  if (input.couponCode) {
    const result = await validateCoupon(input.couponCode, customerId, cartLinesForCoupon);
    discountAmount = result.discountAmount;
    couponId = result.coupon.id;
    couponCode = result.coupon.code;

    const coupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    if (coupon.vendorId) {
      const current = vendorSubtotals.get(coupon.vendorId) ?? 0;
      vendorSubtotals.set(coupon.vendorId, Math.max(0, current - discountAmount));
    }
  }

  const subtotalAmount = totalAmount;
  totalAmount = Math.max(0, totalAmount - discountAmount);

  for (const [vendorId, group] of vendorGroups) {
    const subtotal = vendorSubtotals.get(vendorId)!;
    const rate = await resolveCommissionRate(vendorId);
    const { commissionAmount, vendorEarnings } = calculateCommission(subtotal, rate);

    vendorOrderData.push({
      vendor: { connect: { id: vendorId } },
      subtotal,
      commissionRate: rate,
      commissionAmount,
      vendorEarnings,
      items: {
        create: group.items.map((i) => ({
          productId: i.product.id,
          productName: i.product.name,
          unitPrice: i.product.price,
          quantity: i.quantity,
          lineTotal: Number(i.product.price) * i.quantity,
        })),
      },
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

  if (couponId) {
    await recordRedemption(couponId, customerId, order.id, discountAmount);
  }

  const paystack = await initializeTransaction({
    email: customerEmail,
    amountNaira: totalAmount,
    reference: paymentReference,
    callbackUrl: `${env.appUrl}/orders/${order.orderNumber}/confirm`,
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
  });

  return { order, checkoutUrl: paystack.authorization_url };
}

/**
 * Idempotent: safe to call from the webhook AND from the customer's
 * post-checkout browser redirect without double-processing a paid order.
 * Always re-verifies against Paystack directly rather than trusting the
 * caller (spec §20).
 */
export async function verifyAndFinalizePayment(reference: string) {
  const order = await prisma.order.findUnique({
    where: { paymentReference: reference },
    include: { vendorOrders: { include: { items: true } } },
  });
  if (!order) throw AppError.notFound("Order not found for this payment reference");

  if (order.paymentStatus === "PAID") {
    return order; // already finalized — nothing to do
  }

  const verification = await verifyTransaction(reference);

  if (verification.status !== "success") {
    await prisma.$transaction([
      prisma.payment.upsert({
        where: { reference },
        create: {
          orderId: order.id,
          reference,
          amount: order.totalAmount,
          status: "FAILED",
          gatewayResponse: verification as unknown as Prisma.InputJsonValue,
        },
        update: { status: "FAILED", gatewayResponse: verification as unknown as Prisma.InputJsonValue },
      }),
      prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "FAILED" } }),
    ]);
    throw AppError.badRequest("Payment was not successful", "PAYMENT_FAILED");
  }

  const paidAmountNaira = verification.amount / 100;
  if (Math.round(paidAmountNaira) !== Math.round(Number(order.totalAmount))) {
    // Amount mismatch is a red flag — never mark an order paid on trust.
    throw AppError.badRequest("Payment amount does not match order total", "AMOUNT_MISMATCH");
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.payment.upsert({
      where: { reference },
      create: {
        orderId: order.id,
        reference,
        amount: paidAmountNaira,
        status: "PAID",
        channel: verification.channel,
        gatewayResponse: verification as unknown as Prisma.InputJsonValue,
      },
      update: {
        status: "PAID",
        channel: verification.channel,
        gatewayResponse: verification as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: "PAID", paidAt: new Date() },
    });

    await tx.vendorOrder.updateMany({
      where: { orderId: order.id },
      data: { status: "PROCESSING" },
    });

    // Decrement stock per line item — done inside the same transaction so
    // a race between two simultaneous checkouts can't oversell.
    for (const vendorOrder of order.vendorOrders) {
      for (const item of vendorOrder.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }
    }
  });

  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) {
    void sendEmail({ to: customer.email, ...orderConfirmationEmail(order.orderNumber) });
  }
  for (const vendorOrder of order.vendorOrders) {
    const vendor = await prisma.vendorProfile.findUnique({
      where: { id: vendorOrder.vendorId },
      include: { user: true },
    });
    if (vendor) {
      void sendEmail({
        to: vendor.user.email,
        ...vendorNewOrderEmail(order.orderNumber, vendorOrder.items.length),
      });
    }
  }

  if (env.adminNotificationEmail) {
    void sendEmail({
      to: env.adminNotificationEmail,
      ...adminNewOrderEmail(order.orderNumber, Number(order.totalAmount)),
    });
  }
  if (env.whatsapp.adminNumber) {
    void sendWhatsAppNotification({
      to: env.whatsapp.adminNumber,
      message: newOrderWhatsAppMessage(order.orderNumber, Number(order.totalAmount)),
      event: "admin_new_order",
    });
  }

  return prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { vendorOrders: { include: { items: true } } },
  });
}

export async function getMyOrders(customerId: string) {
  return prisma.order.findMany({
    where: { customerId },
    include: { vendorOrders: { include: { items: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrderByNumber(orderNumber: string, requesterId: string, requesterRole: string) {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      vendorOrders: { include: { items: true, vendor: true } },
    },
  });
  if (!order) throw AppError.notFound("Order not found");

  const isOwner = order.customerId === requesterId;
  const isVendorOnOrder = order.vendorOrders.some((vo: { vendor: { userId: string } }) => vo.vendor.userId === requesterId);
  const isAdmin = requesterRole === "ADMIN";

  if (!isOwner && !isVendorOnOrder && !isAdmin) {
    throw AppError.forbidden("You don't have access to this order");
  }

  return order;
}

export async function getMyVendorOrders(userId: string) {
  const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });
  return prisma.vendorOrder.findMany({
    where: { vendorId: vendor.id },
    include: { items: true, order: true },
    orderBy: { createdAt: "desc" },
  });
}

const FORWARD_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  REFUND_REQUESTED: ["REFUNDED"],
  REFUNDED: [],
  FAILED: [],
};

export async function updateVendorOrderStatus(
  userId: string,
  vendorOrderId: string,
  nextStatus: OrderStatus
) {
  const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });
  const vendorOrder = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId } });

  if (!vendorOrder || vendorOrder.vendorId !== vendor.id) {
    throw AppError.notFound("Order not found");
  }

  const allowed = FORWARD_TRANSITIONS[vendorOrder.status as OrderStatus];
  if (!allowed.includes(nextStatus)) {
    throw AppError.badRequest(
      `Can't move an order from ${vendorOrder.status} to ${nextStatus}`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  return prisma.vendorOrder.update({
    where: { id: vendorOrderId },
    data: { status: nextStatus },
  });
}

/**
 * Admin-initiated full refund (spec §21/§31 — refund architecture,
 * "Refund decisions"). Real Paystack API call, not a status flip on
 * trust — if Paystack rejects the refund, nothing on our side changes.
 * Restocks every item and marks all of the order's VendorOrders REFUNDED,
 * since a partial multi-vendor refund isn't supported in this pass (see
 * README).
 */
export async function refundOrder(orderId: string, adminId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { vendorOrders: { include: { items: true } } },
  });
  if (!order) throw AppError.notFound("Order not found");
  if (order.paymentStatus !== "PAID") {
    throw AppError.badRequest("Only paid orders can be refunded", "ORDER_NOT_PAID");
  }

  await refundTransaction(order.paymentReference, Number(order.totalAmount));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "REFUNDED" } });
    await tx.vendorOrder.updateMany({
      where: { orderId: order.id },
      data: { status: "REFUNDED" },
    });
    for (const vendorOrder of order.vendorOrders) {
      for (const item of vendorOrder.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
  });

  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) {
    void sendEmail({ to: customer.email, ...orderRefundedEmail(order.orderNumber) });
  }

  await recordAudit({ actorId: adminId, action: "ORDER_REFUNDED", targetType: "Order", targetId: order.id });

  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } });
}

export async function adminListOrders(page: number, limit: number, paymentStatus?: string) {
  const where = paymentStatus ? { paymentStatus: paymentStatus as never } : {};
  const [items, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: { customer: { select: { firstName: true, lastName: true, email: true } }, vendorOrders: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}
