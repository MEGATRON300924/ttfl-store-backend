import { z } from "zod";

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
      })
    )
    .min(1, "Cart is empty"),
  couponCode: z.string().min(1).max(30).optional(),
  delivery: z.object({
    name: z.string().min(2).max(120),
    phone: z.string().min(7).max(20),
    line1: z.string().min(3).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(2).max(80),
    state: z.string().min(2).max(80),
    country: z.string().min(2).max(80).default("Nigeria"),
  }),
});

export const updateVendorOrderStatusSchema = z.object({
  status: z.enum([
    "PROCESSING",
    "SHIPPED",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "CANCELLED",
  ]),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
