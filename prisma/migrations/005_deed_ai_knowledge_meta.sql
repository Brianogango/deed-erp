-- Additive columns for Deed AI knowledge provenance (website / SOP citations).
-- Safe to run after `npx prisma db push` if columns were not yet applied.

ALTER TABLE ai_documents
  ADD COLUMN IF NOT EXISTS source_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS category VARCHAR(100);
