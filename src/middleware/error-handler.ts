import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "@/utils/app-error";
import { logger } from "@/lib/logger";
import { createErrorReferenceCode, recordError } from "@/modules/error-logging/error-logging.service";

function respondWithLoggedError(req: Request, res: Response, status: number, code: string, message: string, details?: unknown, explanation?: string, stack?: string) {
  const referenceCode = createErrorReferenceCode();
  void recordError({
    referenceCode,
    errorCode: code,
    message,
    explanation,
    httpStatus: status,
    req,
    userId: req.user?.sub,
    orderNumber: typeof req.body?.orderNumber === "string" ? req.body.orderNumber : undefined,
    productId: typeof req.body?.productId === "string" ? req.body.productId : undefined,
    metadata: details && typeof details === "object" ? { details } : undefined,
    stack,
  });
  return res.status(status).json({
    error: {
      code,
      referenceCode,
      message,
      details,
      supportMessage: `If you contact TTFL Store Support, provide error code ${referenceCode}.`,
    },
  });
}

export function notFoundHandler(req: Request, res: Response) {
  return respondWithLoggedError(
    req,
    res,
    404,
    "NOT_FOUND",
    `No route for ${req.method} ${req.path}`,
    undefined,
    "A request reached TTFL Store without a matching API route. Check the URL, HTTP method, and deployed backend route configuration.",
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    const flattened = err.flatten();
    const labels: Record<string, string> = {
      name: "Product name",
      description: "Product description",
      categorySlug: "Product category",
      price: "Price",
      previousPrice: "Previous price",
      condition: "Condition",
      stock: "Stock",
      location: "Location",
      tags: "Search tags",
      images: "Product photos",
      videos: "Product videos",
      specifications: "Product details",
      estimatedDeliveryDays: "Estimated delivery",
      comingSoon: "Coming soon",
      availableAt: "Expected availability",
      sellingMethod: "How customers buy",
      externalUrl: "External product link",
      whatsappNumber: "WhatsApp number",
    };
    const fieldMessages = Object.entries(flattened.fieldErrors)
      .flatMap(([field, messages]) => (messages ?? []).map((message) => `${labels[field] ?? field}: ${message}`));
    const problems = [...fieldMessages, ...flattened.formErrors];
    const message = problems.length
      ? `Your request could not be completed. Please check the following: ${problems.join("; ")}`
      : "Your request could not be completed. Please check the information you entered and try again.";
    return respondWithLoggedError(
      req,
      res,
      400,
      "VALIDATION_ERROR",
      message,
      flattened,
      "The request failed validation before TTFL Store could complete the operation. Review the recorded fields and the page or API route that submitted them.",
    );
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error(err.message, { code: err.code, stack: err.stack });
    return respondWithLoggedError(
      req,
      res,
      err.statusCode,
      err.code,
      err.message,
      err.details,
      undefined,
      err.stack,
    );
  }

  logger.error("Unhandled error", { err });
  return respondWithLoggedError(
    req,
    res,
    500,
    "INTERNAL_ERROR",
    "Something went wrong",
    undefined,
    "TTFL Store encountered an unexpected server error. Review the stack trace, request path, and related order or product context in the error log.",
    err instanceof Error ? err.stack : undefined,
  );
}

// Wraps async route handlers so rejected promises reach errorHandler
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
