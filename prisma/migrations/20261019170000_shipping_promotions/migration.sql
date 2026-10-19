-- Add configurable delivery pricing and free-shipping promotions without changing existing order data.
ALTER TYPE "CouponType" ADD VALUE IF NOT EXISTS 'FREE_SHIPPING';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveryAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
