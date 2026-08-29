-- Customer/vendor contacts default to due immediately (0 days), not Net 30.
-- Explicit credit terms (7/14/45/60/90) are left unchanged.
-- Safe to re-run.

ALTER TABLE clients
  ALTER COLUMN payment_terms_days SET DEFAULT 0;

UPDATE clients
   SET payment_terms_days = 0
 WHERE payment_terms_days IS NULL
    OR payment_terms_days = 30;
