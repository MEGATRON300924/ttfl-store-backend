import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { prisma } from "@/lib/prisma";

const EXPLANATIONS: Record<string, string> = {
  ORDER_NOT_CONFIRMED: "The order could not be confirmed. Check the order record, payment state, inventory reservation, and any gateway response before asking the customer to retry.",
  PAYMENT_FAILED: "Payment did not complete successfully. Check the payment reference and gateway response, then confirm whether the order should remain pending or be cancelled.",
  PAYMENT_VERIFICATION_FAILED: "The payment gateway response could not be verified against the TTFL order. Check the payment reference, amount, currency, and gateway response.",
  PRODUCT_NOT_FOUND: "The requested product could not be found or is no longer available. Check the product record, deletion status, and the product ID supplied by the customer.",
  PRODUCT_UNAVAILABLE: "The product is currently unavailable for the requested action. Check stock, status, selling method, and vendor availability.",
  OUT_OF_STOCK: "The product does not have enough stock for the requested quantity. Check the product stock and any concurrent reservations.",
  ORDER_NOT_FOUND: "The referenced order could not be found. Check the order number and customer ownership before taking action.",
  VALIDATION_ERROR: "The request contained invalid or incomplete data. Review the fields recorded for the failed request and the customer-facing form.",
  UNAUTHORIZED: "The request was not authenticated. Check the customer's session or login state.",
  FORBIDDEN: "The authenticated account does not have permission for this action. Check the account role and resource ownership.",
  RATE_LIMITED: "The request was blocked by rate limiting. Check request frequency and whether the customer should simply retry later.",
  INTERNAL_ERROR: "An unexpected server error occurred. Review the stack trace and surrounding logs, then reproduce the request if possible.",
};

export function createErrorReferenceCode() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `TTFL-ERR-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function recordError(input: {
  referenceCode: string;
  errorCode: string;
  message: string;
  explanation?: string;
  httpStatus: number;
  req: Request;
  userId?: string | null;
  orderNumber?: string | null;
  productId?: string | null;
  metadata?: Record<string, unknown>;
  stack?: string | null;
}) {
  try {
    const body = input.req.body && typeof input.req.body === "object" ? input.req.body as Record<string, unknown> : {};
    const params = input.req.params ?? {};
    const productId = input.productId || safeString(params.productId) || safeString(body.productId);
    const orderNumber = input.orderNumber || safeString(params.orderNumber) || safeString(body.orderNumber);

    let orderId: string | undefined;
    let resolvedOrderNumber = orderNumber;
    let resolvedProductId = productId;
    let productName: string | undefined;
    let vendorId: string | undefined;
    let vendorName: string | undefined;

    if (orderNumber) {
      const order = await prisma.order.findFirst({
        where: { orderNumber },
        select: {
          id: true,
          orderNumber: true,
          vendorOrders: {
            select: {
              vendor: { select: { id: true, storeName: true } },
              items: { select: { productId: true, productName: true } },
            },
          },
        },
      });
      if (order) {
        orderId = order.id;
        resolvedOrderNumber = order.orderNumber;
        const firstItem = order.vendorOrders.flatMap((vendorOrder) => vendorOrder.items)[0];
        const firstVendor = order.vendorOrders[0]?.vendor;
        resolvedProductId = resolvedProductId || firstItem?.productId;
        productName = firstItem?.productName;
        vendorId = firstVendor?.id;
        vendorName = firstVendor?.storeName;
      }
    }

    if (resolvedProductId) {
      const product = await prisma.product.findFirst({
        where: { id: resolvedProductId },
        select: { id: true, name: true, vendor: { select: { id: true, storeName: true } } },
      });
      if (product) {
        resolvedProductId = product.id;
        productName = product.name;
        vendorId = product.vendor?.id;
        vendorName = product.vendor?.storeName;
      }
    }

    await prisma.errorLog.create({
      data: {
        id: randomBytes(16).toString("hex"),
        referenceCode: input.referenceCode,
        severity: input.httpStatus >= 500 ? "CRITICAL" : "ERROR",
        httpStatus: input.httpStatus,
        errorCode: input.errorCode,
        message: input.message,
        explanation: input.explanation || EXPLANATIONS[input.errorCode] || "TTFL Store encountered an error while processing this request. Review the request context, related resource, and server logs.",
        method: input.req.method,
        path: input.req.path,
        userId: input.userId || null,
        orderId: orderId || null,
        orderNumber: resolvedOrderNumber || null,
        productId: resolvedProductId || null,
        productName: productName || null,
        vendorId: vendorId || null,
        vendorName: vendorName || null,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
        stack: input.stack || null,
        ipAddress: input.req.ip || null,
      },
    });
  } catch (loggingError) {
    console.error("Failed to persist TTFL error log:", loggingError);
  }
}

export async function searchErrorLogs(query: string | undefined, page: number, limit: number) {
  const normalized = query?.trim();
  const where = normalized
    ? {
        OR: [
          { referenceCode: { contains: normalized, mode: "insensitive" as const } },
          { errorCode: { contains: normalized, mode: "insensitive" as const } },
          { orderNumber: { contains: normalized, mode: "insensitive" as const } },
          { productId: { contains: normalized, mode: "insensitive" as const } },
          { productName: { contains: normalized, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await prisma.$transaction([
    prisma.errorLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, referenceCode: true, severity: true, httpStatus: true, errorCode: true,
        message: true, explanation: true, method: true, path: true, userId: true,
        orderId: true, orderNumber: true, productId: true, productName: true,
        vendorId: true, vendorName: true, metadata: true, stack: true, createdAt: true,
      },
    }),
    prisma.errorLog.count({ where }),
  ]);

  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getErrorLog(referenceCode: string) {
  return prisma.errorLog.findUnique({ where: { referenceCode } });
}
