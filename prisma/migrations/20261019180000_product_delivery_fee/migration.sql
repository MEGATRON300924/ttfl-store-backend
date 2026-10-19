-- Optional per-product shipping price. NULL inherits the platform's standard delivery fee.
ALTER TABLE products ADD COLUMN IF NOT EXISTS "deliveryFee" DECIMAL(12,2);
