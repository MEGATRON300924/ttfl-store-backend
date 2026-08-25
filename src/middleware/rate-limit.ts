import rateLimit from "express-rate-limit";
import { env } from "@/config/env";

export const authRateLimiter = rateLimit({
  windowMs: env.authRateLimit.windowMin * 60 * 1000,
  max: env.authRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many attempts. Please wait a few minutes and try again.",
    },
  },
});

// Looser limiter for read-mostly endpoints
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
