# Deed AI Assistant — RAG + ERP tools + voice

Status: **V1 in progress**. JARVIS is the in-product name for this assistant.
This document is the architecture contract for Gemini + knowledge retrieval +
live ERP tools + voice — not a generic chatbot integration.

## Principle

Do **not** fine-tune Gemini on ERP data, and do **not** crawl the ERP UI.

| Knowledge type | Examples | Mechanism |
|----------------|----------|-----------|
| Static / semi-static | deed.africa, policies, FAQs, SOPs, product/help copy | RAG / indexed chunks |
| Live ERP | inventory, repairs, quotes, invoices, customers | Secured function calls |

Every answer should show its **basis** (live tool vs knowledge document).
Permissions from the signed-in user must carry through every tool call.

## Three layers

```
                 ┌───────────────────┐
                 │    DEED AI        │
                 │  Text + Voice UI  │
                 └─────────┬─────────┘
                           │
                    Gemini API
                 (+ Live API later)
                           │
          ┌────────────────┴────────────────┐
          │                                 │
   KNOWLEDGE SEARCH                     ERP TOOLS
        (RAG)                              (Live)
          │                                 │
  Website / SOPs / FAQs           Prisma tools via runTool()
  Policies / manuals              Inventory · Sales · Repairs
  Product information             Finance · Purchasing · CRM
```

### 1. Knowledge ingestion

- **Website:** WordPress REST API on `deed.africa` (pages + posts) → clean text
  chunks → `ai_documents` / `ai_document_chunks` with `sourceType=website`.
- **SOPs:** Structured SOP Documents (+ image OCR) already ingested.
- **Not crawled:** ERP screens, serials, stock, invoices, payroll.
- Index today: Postgres FTS (`content_tsv`). Optional later: Gemini File Search
  or embeddings/pgvector without changing the tool boundary.

### 2. Gemini assistant

At question time:

1. **Retrieve** relevant knowledge passages (auto + `search_documents` tool).
2. **Call ERP tools** for live facts (`check_inventory`, `track_repair`, …).
3. Answer only from retrieved passages and tool results — never invent ERP numbers.
4. Return structured **sources** to the UI.

### 3. Voice

- **V1:** Browser speech-to-text (mic) + optional speech synthesis for replies.
- **Phase 2:** Gemini Live API for low-latency bidirectional audio, still using
  the same RAG + `runTool()` backend (Live never bypasses permissions).

## Source attribution (required)

Example chips:

- Inventory · live
- Repair REP-352227 · live
- Warranty Policy · knowledge · updated 02 Aug 2026

## Permissions

- UI gated by `jarvis` module.
- Each tool: role allow-list → module → audit log (`ai_audit_logs`).
- Mutating actions remain draft-only until explicit human confirmation.

## V1 scope (this branch)

- [x] Architecture document (this file)
- [x] Website knowledge ingest (WP REST) + admin/cron ingest
- [x] Auto-retrieve knowledge into each chat turn
- [x] Richer `search_documents` citations (url, type, dates)
- [x] API + UI source chips (live vs knowledge)
- [x] Mic button (browser STT) foundation
- [ ] Gemini Live API streaming session
- [ ] Embeddings / Gemini File Search upgrade
- [ ] Cautious write actions with confirmation

## Related code

- Chat: `lib/jarvis/chat-engine.ts`, `app/api/jarvis/chat`
- Knowledge: `lib/jarvis/ingest.ts`, `lib/jarvis/knowledge.ts`
- Tools: `lib/jarvis/tools/*` + `lib/jarvis/run-tool.ts`
- UI: `components/jarvis/JarvisPanel.tsx`
