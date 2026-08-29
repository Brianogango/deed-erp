-- Phase 2a repairs cutover: full blob payload on the relational row so read
-- surfaces (portal, repairs API) can serve from the table. Additive.

BEGIN;

ALTER TABLE repairs ADD COLUMN IF NOT EXISTS payload JSONB;

COMMIT;
