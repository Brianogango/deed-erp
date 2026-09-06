ALTER TABLE "sale_orders"
ADD COLUMN "terms_and_conditions" TEXT,
ADD COLUMN "optional_products" JSONB;
