-- Migration: JARVIS AI layer (additive only — no existing table is altered)
--
-- Run `npx prisma db push` first to create the five new tables declared in
-- schema.prisma (ai_conversations, ai_messages, ai_audit_logs, ai_documents,
-- ai_document_chunks), then run this file to add the foreign keys and the
-- full-text search index that Prisma's schema doesn't express directly.

-- FK constraints (kept out of schema.prisma so the User model's relation
-- list is never touched).
ALTER TABLE ai_conversations
  ADD CONSTRAINT fk_ai_conversations_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ai_audit_logs
  ADD CONSTRAINT fk_ai_audit_logs_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ai_audit_logs
  ADD CONSTRAINT fk_ai_audit_logs_conversation
  FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE SET NULL;

-- Full-text search over document chunks (MVP RAG retrieval — Postgres
-- native search, no extension required; can be upgraded to pgvector +
-- semantic embeddings later without touching this table's shape).
ALTER TABLE ai_document_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_tsv
  ON ai_document_chunks USING GIN (content_tsv);
