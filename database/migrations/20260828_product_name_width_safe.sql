-- Vendor catalog titles (Lenovo/HP spec strings) exceed varchar(200).
-- Widening products.name is additive and non-destructive.

BEGIN;

ALTER TABLE products
  ALTER COLUMN name TYPE varchar(500);

COMMIT;
