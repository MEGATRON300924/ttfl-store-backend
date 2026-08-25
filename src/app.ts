import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "@/config/env";
import { attachUser } from "@/middleware/auth";
import { generalRateLimiter } from "@/middleware/rate-limit";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler";
import { authRouter } from "@/modules/auth/auth.routes";
import { vendorsRouter } from "@/modules/vendors/vendors.routes";
import { categoriesRouter } from "@/modules/categories/categories.routes";
import { productsRouter } from "@/modules/products/products.routes";
import { ordersRouter } from "@/modules/orders/orders.routes";
import { paystackWebhook } from "@/modules/orders/orders.controller";
import { vendorPlansRouter } from "@/modules/vendor-plans/vendor-plans.routes";
import { reviewsRouter } from "@/modules/reviews/reviews.routes";
import { wishlistRouter } from "@/modules/wishlist/wishlist.routes";
import { couponsRouter } from "@/modules/coupons/coupons.routes";
import { subscriptionsRouter } from "@/modules/subscriptions/subscriptions.routes";
import { featuredRouter } from "@/modules/featured/featured.routes";
import { payoutsRouter } from "@/modules/payouts/payouts.routes";
import { analyticsRouter } from "@/modules/analytics/analytics.routes";
import { supportRouter } from "@/modules/support/support.routes";
import { uploadsRouter } from "@/modules/uploads/uploads.routes";
import { settingsRouter } from "@/modules/settings/settings.routes";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // needed for correct req.ip behind Render's proxy

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
    })
  );

  // Paystack webhook MUST be registered before express.json() with a raw
  // body parser, because signature verification (lib/paystack.ts) needs
  // the exact bytes Paystack sent — re-serializing a parsed JSON object
  // would produce a different byte string and always fail verification.
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json" }),
    (req, _res, next) => {
      (req as typeof req & { rawBody: Buffer }).rawBody = req.body;
      req.body = JSON.parse(req.body.toString("utf8"));
      next();
    },
    paystackWebhook
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(generalRateLimiter);
  app.use(attachUser);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "ttfl-store-backend", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/vendors", vendorsRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/vendor-plans", vendorPlansRouter);
  app.use("/api/reviews", reviewsRouter);
  app.use("/api/wishlist", wishlistRouter);
  app.use("/api/coupons", couponsRouter);
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/featured", featuredRouter);
  app.use("/api/payouts", payoutsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/support", supportRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/settings", settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
