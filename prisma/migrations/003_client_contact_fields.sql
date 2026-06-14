-- Migration: Preserve legacy contact fields on Prisma clients
-- Contacts still broadcast to deed_contacts for compatibility, but clients is now authoritative.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(60),
  ADD COLUMN IF NOT EXISTS website VARCHAR(200),
  ADD COLUMN IF NOT EXISTS is_customer BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_vendor BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bank_account VARCHAR(80),
  ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vendor_rating DECIMAL(4, 2),
  ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0;
