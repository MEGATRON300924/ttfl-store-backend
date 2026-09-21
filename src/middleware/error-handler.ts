import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "@/utils/app-error";
import { logger } from "@/lib/logger";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: (() => {
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
            .flatMap(([field, messages]) =>
              (messages ?? []).map((message) => `${labels[field] ?? field}: ${message}`)
            );
          const formMessages = flattened.formErrors;
          const problems = [...fieldMessages, ...formMessages];
          return problems.length
            ? `Your product could not be listed yet. Please check the following: ${problems.join("; ")}`
            : "Your product could not be listed yet. Please check the information you entered and try again.";
        })(),
        details: err.flatten(),
      },
    });
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { code: err.code, stack: err.stack });
    }
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  logger.error("Unhandled error", { err });
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
}

// Wraps async route handlers so rejected promises reach errorHandler
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
