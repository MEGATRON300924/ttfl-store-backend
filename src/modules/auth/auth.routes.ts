import { Router } from "express";
import * as authController from "./auth.controller";
import { authRateLimiter } from "@/middleware/rate-limit";
import { requireAuth } from "@/middleware/auth";

export const authRouter = Router();

// Public
authRouter.post("/register/customer", authRateLimiter, authController.registerCustomer);
authRouter.post("/register/vendor", authRateLimiter, authController.registerVendor);
authRouter.post("/login", authRateLimiter, authController.login);
authRouter.post("/refresh", authController.refresh);
authRouter.post("/logout", authController.logout);
authRouter.post("/verify-email", authController.verifyEmail);
authRouter.post("/forgot-password", authRateLimiter, authController.forgotPassword);
authRouter.post("/reset-password", authRateLimiter, authController.resetPassword);

// Authenticated
authRouter.get("/me", requireAuth, authController.me);
authRouter.patch("/me", requireAuth, authController.updateProfile);
authRouter.patch("/me/avatar", requireAuth, authController.updateAvatar);
authRouter.post("/change-password", requireAuth, authController.changePassword);
authRouter.delete("/account", requireAuth, authController.deleteAccount);
