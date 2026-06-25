# JARVIS — AI Intelligence Layer for Deed ERP

Status: design only. No JARVIS code has been written yet. This document is the
result of inspecting the live codebase (not assumptions) and is the basis for
implementation review before any code is generated.

---

## 1. Current ERP Architecture Review

### 1.1 Frontend
- Next.js 14 (App Router), React 18, Tailwind, TypeScript.
- Page shell: `components/AppShell.tsx`, `components/layout/Sidebar.tsx`,
  `components/layout/Topbar.tsx`, `components/layout/GlobalSearch.tsx`.
- ~36 feature modules under `components/modules/*.tsx` (Sales, CRM, Inventory,
  Purchase, POS, Repair/Refurbishment, Delivery, Ecommerce, Kilimall,
  Accounting, HR, Outsource, SOPs/SOPDocuments, AfterSales, Deposits,
  Holdovers, Expenses, MyDocuments…), matching `MODULE_IDS` in
  `lib/auth/types.ts`.
- Client data layer: `lib/store.tsx` — a large set of TypeScript domain types
  (`Client`, `Quote`, `Opportunity`, `Product`, `SaleOrder`, `Invoice`,
  `Payment`, `OutboundRelease`, `Deposit`, …) plus the `useApp()` hook that
  most modules read/write through. `hooks/useLS.ts` indicates the app
  originated as a local-storage-first client app.

### 1.2 Backend — two coexisting persistence models
This is the single most important architectural fact for JARVIS design.

**(A) Relational source of truth (Prisma + Postgres).**
`prisma/schema.prisma` (1,770 lines, ~58 models) is a real, normalized schema:
`User`, `UserSession`, `AuditLog`, `CompanySetting`, `Department`,
`Employee`, `LeaveRequest`, `PayrollRun`/`Payslip`, `Client`, `Supplier`,
`Product`/`SerialNumber`/`StockLevel`/`StockMovement`, `PurchaseOrder`,
`Opportunity`/`ContactPerson`, `SaleOrder`, `Quote`, `Invoice`, `Payment`,
`CreditNote`, `DeliveryNote`, `Repair` (+ `RepairStage`/`RepairPart`/
`RepairDiagnostic`/`RepairClientCommunication`), `PosSession`/`PosTransaction`,
`KilimallListing`/`KilimallOrder`, `OutboundRelease` (dispatch/QC/signature
workflow). Dedicated REST routes (`app/api/invoices`, `/api/employees`,
`/api/products`, `/api/sale-orders`, `/api/repairs`, `/api/quotes`, …) query
Prisma directly and enforce role checks (e.g. `app/api/invoices/route.ts`
calls `requireRole(['director','finance_officer','admin_officer'])` before
writes). **This is the layer JARVIS must read/write through.**

**(B) Generic JSON blob store (`app_state` table).**
`lib/server-store.ts` defines a single key/value table
(`app_state(key TEXT PK, value TEXT, updated_at)`), exposed via
`/api/store`, `/api/store/[key]`, `/api/store/stream` (poll-based sync used
by the client `useApp()` store), `/api/store/provenance` and
`/api/store/restore-preview` (version history / point-in-time restore).
Company documents (SOP files) are stored here too —
`app/api/sop-files/[sopId]/route.ts` stores each file as a base64 blob under
key `sop_file_<sopId>` (PDF/DOC/DOCX/JPEG/PNG, 5 MB cap), separate from the
lightweight `sop_documents` metadata list. This blob layer is a legacy/transition
mechanism with **no schema validation and no per-field audit trail** — it is
the right place for JARVIS to *read* documents from (for RAG ingestion) but
the wrong place for JARVIS to write business data into.

### 1.3 Authentication — two systems currently coexist
- **NextAuth** (`app/api/auth/[...nextauth]`, JWT, cookie `deed-session`) is
  what `middleware.ts` actually checks via `getToken()` to gate every
  `/api/*` request and every page route. This is the real front door.
- A **separate custom session module** (`lib/auth/session.ts`, HMAC-signed
  token, cookie `deed_erp_session`) backs `/api/auth/login` /
  `/api/auth/logout` and is read server-side via `lib/auth/server.ts` →
  `getServerSession()`, consumed by `lib/auth/api.ts`
  (`getRequiredSession`, `requireRole`, `requirePermission`,
  `withApiErrorHandling`) — this is the helper set every API route handler
  actually uses for its own auth/role check, independent of the middleware.

This dual-session state looks like an in-progress migration. JARVIS must not
add a third auth mechanism — it reuses `getRequiredSession` /
`requireRole` / `requirePermission` exactly as existing routes do.

### 1.4 Roles & permissions (already fairly granular)
- `lib/auth/types.ts`: 8 canonical roles (`director`, `admin_officer`,
  `finance_officer`, `inventory_officer`, `kilimall_officer`, `sales_rep`,
  `technical_lead`, `technician`) and 22 `ModuleId`s, with
  `ROLE_DEFAULT_MODULES` per role and `SELF_SERVICE_MODULES` open to everyone.
- `lib/auth/access.ts`: `hasModuleAccess`, `normalizeClientRole` (collapses
  legacy aliases like `admin`/`super_admin` → `director`), composite checks
  (`canManageMoney`, `canManageProcess`, `canManageTech`,
  `canManageSettings`, `canViewAuditTrail`).
- `lib/auth/authorization.ts`: a finer **action-level** permission matrix
  (`PermissionAction`): `manageUsers`, `viewUsers`, `manageHR`,
  `approveLeave`, `approvePayroll`, `manageInventoryApprovals`,
  `postFinancial`, `approvePurchaseOrder`, `approveDiscount`,
  `manageMasterData`, `viewAuditLog` — checked via `hasPermission`/
  `assertPermission`. Prisma's own `UserRole` enum carries extra legacy
  values (`release_authoriser`, etc.) normalized down to the 8 canonical
  roles.
- **`AuditLog` already exists** as a real Prisma model: `userId`, `action`,
  `entityType`, `entityId`, `oldValues`/`newValues` (JSON), `ipAddress`,
  `createdAt`, indexed on user/entity/date. JARVIS audit logging should
  follow this same shape (see §5).

### 1.5 Existing "send" pattern (important precedent)
`app/api/quotes/send/route.ts` and `app/api/invoices/[id]/send/route.ts`
already implement "generate PDF → send via email/WhatsApp", but are only
ever invoked by an explicit user click in the UI — there is no autonomous
sending today. **JARVIS must follow this exact precedent**: draft only,
human clicks send, same endpoint fires.

### 1.6 Integrations already wired
- Email: 3 providers behind one interface (`lib/integrations/email.ts`,
  SendGrid / AWS SES / SMTP, selected by `EMAIL_PROVIDER` env var, with
  per-department mailbox profiles in `.env.example`: HR/SALES/ACCOUNTS).
- WhatsApp/SMS: `lib/integrations/whatsapp.ts`, `messaging.ts` (Meta WhatsApp
  Business API + Twilio fallback).
- Calendar: `lib/integrations/calendar.ts` + `app/api/integrations/calendar`
  (Google OAuth).
- PDF generation: `lib/pdf.ts`, `lib/pdf-quote.ts`, `lib/delivery-note-pdf.ts`.
- Rate limiting: `lib/rate-limit.ts` + Upstash Redis, policy-keyed per route
  in `middleware.ts` (login, admin-reset, store writes, store-stream reads,
  generic api-write/api-read buckets).

### 1.7 AI surface today: effectively zero
`@anthropic-ai/sdk` is already listed in `package.json` but is **not
imported anywhere in the codebase** — it was added but never wired up. The
closest thing to "AI" today is `/api/scan-receipt` and
`/api/scan-purchase-document`, which use `tesseract.js` (local OCR) plus
hand-written regex parsing — no LLM call at all. This means JARVIS is not
competing with or duplicating any existing AI logic; it's a genuinely clean
slate, and the SDK dependency is already approved/installed.

### 1.8 Current limitations / hygiene issues worth knowing about
- **Stray duplicate files inside `components/modules/`**: `schema.prisma`
  (593 lines, an old/divergent copy of the real 1,770-line
  `prisma/schema.prisma`), plus `middleware.ts`, `page.tsx`, `route.ts`,
  `payroll.ts`, `repair-config.ts`, `invoice-pdf.ts`. These look like an
  accidental nested copy from a past merge/extraction. They are not wired
  into the Next.js route tree, so they don't affect runtime — but they are a
  trap for "which file is real" confusion. Not in scope for JARVIS, but
  flagged so it isn't mistaken for an alternate architecture.
- **Dual persistence (Prisma vs `app_state` blob)** means "the ERP" is not
  one single source of truth — it's two, with the relational side being
  authoritative for transactional entities and the blob side covering
  whatever hasn't been migrated yet (and documents). JARVIS's tool layer
  needs an explicit map of "which entity lives where" (see §4).
- **Dual auth/session systems** (NextAuth + custom HMAC session) — both
  currently load-bearing. Any new JARVIS code must reuse existing helpers
  rather than picking one and reimplementing.
- One pre-existing, unrelated TypeScript error: `lib/rate-limit.ts` (ioredis
  type mismatch) — present since the initial commit, not caused by recent
  work, not blocking, not part of this task.

---

## 2. AI Integration Opportunities

Grouped by how close they are to "read-only Q&A" vs "drafts a business action":

**Read-only / Q&A (lowest risk, highest immediate value)**
- Search customers/contacts/companies by name, phone, history.
- Check inventory levels, serials, stock by location.
- Explain an invoice (line items, payment status, balance).
- Track a repair (status, technician, parts used, ETA).
- Check warranty status for a serial/customer.
- Summarize sales for a period/rep/product.
- Identify overdue invoices/payments.
- Summarize procurement needs (low stock vs reorder point).
- Answer company policy / SOP questions (RAG over `sop_documents`).
- Answer product/spec questions (RAG over `my_documents` / product docs).

**Draft generation (medium risk — output is a draft, never sent automatically)**
- Generate a quotation draft (from a conversational request → structured
  quote payload the user reviews in the existing Quote form/modal).
- Draft a customer email or WhatsApp message (using existing
  `email-templates.ts` voice/tone as a base) — user must hit the existing
  Send button.
- Draft a management report / weekly summary for a director.

**Recommendations (medium risk — advisory only, no write)**
- Recommend stock purchases (based on stock levels + sales velocity +
  pending sale orders).
- Flag at-risk receivables / aging.

**Out of MVP scope (higher risk — defer)**
- Autonomous sending of any communication.
- Autonomous posting of financial transactions (payments, invoices, journal
  entries, discounts, refunds, payroll actions).
- Autonomous stock adjustments or purchase order creation.
- Voice interface, WhatsApp-as-a-channel-into-JARVIS, executive dashboards,
  inventory forecasting models — explicitly named by you as later phases.

---

## 3. Safe Integration Points

The guiding rule: **JARVIS is additive only.** It must never edit an
existing file's business logic. Concretely, safe integration points are:

1. **New UI surface, not a new page.** A slide-over chat panel mounted from
   `components/AppShell.tsx` (a button in `Topbar.tsx` next to
   `GlobalSearch`), rendered only when the user's session allows it. No
   existing module file is touched.
2. **New, isolated API namespace**: `app/api/jarvis/*` (e.g.
   `/api/jarvis/chat`, `/api/jarvis/tools/*`). Existing `/api/*` routes are
   never modified.
3. **New, additive Prisma models** appended to `prisma/schema.prisma` via a
   new migration (no edits to existing models, no renames, no dropped
   columns). See §5.
4. **Tool-calling, not query-generation.** JARVIS must never get raw SQL or
   raw Prisma-client access. Every "read ERP data" or "perform an action"
   capability is a named, narrow tool function that internally calls the
   *existing* REST endpoints (`fetch('/api/invoices')`, etc.) or a thin
   read-only Prisma query mirroring exactly what that endpoint already
   returns. This guarantees JARVIS inherits existing validation, role checks,
   and business rules for free, and can never bypass them.
5. **Reuse, don't replace, auth.** All JARVIS routes call
   `getRequiredSession()` / `requireRole()` / `requirePermission()` from
   `lib/auth/api.ts` exactly like existing routes.
6. **Reuse, don't replace, send.** Drafted emails/WhatsApp messages are
   handed back to the existing Quote/Invoice/Sales UI components and sent
   through the existing `/api/quotes/send`, `/api/invoices/[id]/send`,
   `lib/integrations/email.ts` / `whatsapp.ts` — JARVIS never calls a send
   function directly from its own backend code.
7. **Document ingestion reads existing storage, doesn't replace it.** RAG
   ingestion reads from the existing `sop_documents` metadata + `sop_file_*`
   blobs (and `my_documents`) on a schedule/webhook, copies extracted text
   into a new `ai_document_chunks` table — the original SOP/document module
   and its storage are untouched.

---

## 4. Required API / Tool Endpoints (MVP set)

All under a new `app/api/jarvis/` namespace, all session+role+permission
gated, all logged to `ai_audit_logs` (§5).

| Endpoint | Purpose |
|---|---|
| `POST /api/jarvis/chat` | Main conversational endpoint. Accepts message + conversation id, runs the LLM with tool-calling, streams response. |
| `GET /api/jarvis/conversations` / `GET /api/jarvis/conversations/[id]` | List/load a user's own chat history (their memory). |
| `POST /api/jarvis/tools/search-customers` | Wraps `/api/companies`, `/api/contact-persons`, `/api/contacts` (read-only). |
| `POST /api/jarvis/tools/check-inventory` | Wraps `/api/products`, stock levels (read-only). |
| `POST /api/jarvis/tools/explain-invoice` | Wraps `/api/invoices/[id]` (read-only). |
| `POST /api/jarvis/tools/track-repair` | Wraps `/api/repairs/[id]` (read-only). |
| `POST /api/jarvis/tools/check-warranty` | Reads `SerialNumber`/`Repair` warranty fields (read-only). |
| `POST /api/jarvis/tools/summarize-sales` | Aggregates `/api/sale-orders` / `/api/invoices` over a period (read-only, computed server-side, not invented). |
| `POST /api/jarvis/tools/overdue-payments` | Aggregates `Invoice`/`Payment` by due date (read-only). |
| `POST /api/jarvis/tools/procurement-summary` | Aggregates `StockLevel` vs reorder thresholds + open `PurchaseOrder`s (read-only). |
| `POST /api/jarvis/tools/draft-quotation` | Builds a **draft** Quote payload shaped exactly like the existing Quote form state; returns it to the client for the user to open in the real Quote modal — does **not** call `POST /api/quotes` itself. |
| `POST /api/jarvis/tools/draft-message` | Builds draft email/WhatsApp text using `lib/integrations/email-templates.ts` conventions; returned to the client for the user to review/edit/send via the existing Send UI. |
| `POST /api/jarvis/tools/search-documents` | RAG query over `ai_document_chunks` (policy/SOP/product docs), returns cited passages. |
| `POST /api/jarvis/ingest/documents` | Admin-triggered (director/admin_officer only) re-ingestion of SOP/document store into embeddings. Not user-facing chat. |

Each tool endpoint:
- Calls `getRequiredSession()` first.
- Re-checks module access (`hasModuleAccess`) and/or `PermissionAction`
  appropriate to the data domain (e.g. financial tools require the same
  checks `postFinancial`/`viewAuditLog`-style routes already require).
- Never accepts a free-form SQL/filter string from the LLM — only typed,
  validated parameters (zod schemas, already a project dependency).
- Writes one `ai_audit_logs` row per call (tool name, params, result
  summary, user id, timestamp).

---

## 5. Database Tables Needed (AI memory + audit) — additive only

All new tables, no existing table touched. Proposed Prisma additions:

```
model AiConversation {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  title       String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  archivedAt  DateTime? @map("archived_at")

  user        User       @relation(fields: [userId], references: [id])
  messages    AiMessage[]

  @@index([userId])
  @@map("ai_conversations")
}

model AiMessage {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @map("conversation_id") @db.Uuid
  role           String   @db.VarChar(20)   // user | assistant | tool
  content        String
  toolName       String?  @map("tool_name")
  toolInput      Json?    @map("tool_input")
  toolOutput     Json?    @map("tool_output")
  citedSources   Json?    @map("cited_sources")  // doc chunk ids used, for traceability
  createdAt      DateTime @default(now()) @map("created_at")

  conversation   AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId])
  @@map("ai_messages")
}

model AiAuditLog {
  id          BigInt   @id @default(autoincrement())
  userId      String?  @map("user_id") @db.Uuid
  toolName    String   @map("tool_name") @db.VarChar(100)
  inputParams Json?    @map("input_params")
  resultMeta  Json?    @map("result_meta")   // row counts, entity ids touched — not full payload duplication
  permissionChecked String @map("permission_checked") @db.VarChar(100)
  allowed     Boolean
  durationMs  Int?     @map("duration_ms")
  ipAddress   String?  @map("ip_address")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([toolName])
  @@index([createdAt])
  @@map("ai_audit_logs")
}

model AiDocument {
  id          String   @id @default(uuid()) @db.Uuid
  sourceType  String   @map("source_type") @db.VarChar(30) // 'sop' | 'my_document' | 'policy'
  sourceId    String   @map("source_id")   // sopId or document key in app_state
  title       String
  mimeType    String   @map("mime_type")
  ingestedAt  DateTime @default(now()) @map("ingested_at")
  checksum    String   // detect re-ingestion need when source file changes

  chunks      AiDocumentChunk[]

  @@unique([sourceType, sourceId])
  @@map("ai_documents")
}

model AiDocumentChunk {
  id          String   @id @default(uuid()) @db.Uuid
  documentId  String   @map("document_id") @db.Uuid
  chunkIndex  Int      @map("chunk_index")
  content     String
  embedding   Unsupported("vector(1536)")  // pgvector — see §6
  createdAt   DateTime @default(now()) @map("created_at")

  document    AiDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("ai_document_chunks")
}
```

Notes:
- `AiAuditLog` is intentionally separate from the existing `AuditLog` model
  rather than reusing it — JARVIS actions have a different shape (tool name,
  permission checked, allowed/denied) and we don't want to risk a migration
  touching the existing `audit_logs` table or its indexes. If you'd rather
  unify them later, that's a follow-up migration, not a day-1 requirement.
- `Unsupported("vector(1536)")` requires the `pgvector` Postgres extension
  (`CREATE EXTENSION IF NOT EXISTS vector;`) — additive, no impact on
  existing tables/queries.
- All new tables use `@@map` to snake_case, consistent with the existing
  schema's convention.

---

## 6. RAG / Document Search Architecture

Source documents already exist — no new upload UI needed for MVP:
- `sop_documents` (metadata) + `sop_file_<id>` blobs in `app_state`
  (PDF/DOC/DOCX/JPEG/PNG, served by `app/api/sop-files/[sopId]/route.ts`).
- `my_documents` module (similar pattern, per the modules list).

Pipeline (batch/admin-triggered, not part of the live chat request path):
1. **Ingest job** (`/api/jarvis/ingest/documents`, director/admin_officer
   only) reads `sop_documents` list, fetches each blob, computes a checksum,
   skips files already ingested with the same checksum.
2. **Extract text**: PDF → `pdf-parse`-style extraction (or reuse a small
   server-side library; for scanned image SOPs, the already-installed
   `tesseract.js` OCR can be reused exactly as `/api/scan-receipt` already
   does it).
3. **Chunk**: ~500–800 token chunks with overlap, stored as `AiDocument` +
   `AiDocumentChunk` rows.
4. **Embed**: call an embeddings API (Voyage AI is Anthropic's recommended
   embeddings partner and pairs naturally with Claude; OpenAI embeddings are
   an equally valid alternative — either works, pick one and keep it behind
   a single `lib/jarvis/embeddings.ts` function so it can be swapped later).
   Store the vector in `AiDocumentChunk.embedding` (pgvector).
5. **Query time**: embed the user's question, `ORDER BY embedding <=> $1
   LIMIT k` (pgvector cosine/IP distance) to retrieve top-k chunks, pass
   them to Claude as context with explicit citation markers, and require the
   model to answer **only** from retrieved chunks for policy/product
   questions — if retrieval returns nothing relevant, the model must say so
   rather than guess.
6. **No invented data rule, enforced structurally, not just by prompt**: any
   tool that touches ERP records returns structured JSON from the real
   endpoint; the chat layer is instructed (and where possible, schema
   constrained) to only state facts that came from a tool result or a
   retrieved document chunk, and to say "I don't have that information" when
   neither source has it.

This avoids standing up a separate vector database (e.g. Pinecone) since
Postgres + pgvector reuses the existing DB, connection pool, and backup
strategy.

---

## 7. Role-Based Permission Model for AI

JARVIS does not get its own permission system — it inherits the existing
one and adds one more layer (tool allow-listing per role):

1. **Module gate**: a tool may only run if `hasModuleAccess(user, module)`
   is true for the module that owns the underlying data (e.g.
   `check-inventory` requires `inventory` module access; `explain-invoice`
   requires `accounting` or `sales`, matching how the existing UI already
   gates those screens).
2. **Action gate**: tools that touch sensitive domains additionally check
   the existing `PermissionAction` matrix from `lib/auth/authorization.ts`
   (e.g. a future "draft purchase order" tool would require
   `approvePurchaseOrder`-equivalent visibility; `overdue-payments` /
   financial summaries are reasonably gated like other `postFinancial`-style
   views).
3. **Row-level scoping**: a `sales_rep` asking "summarize my sales" gets
   their own orders only; `director`/`finance_officer` get full visibility.
   This mirrors how modules already scope data by `currentUserId` /
   `ownerId` in the existing components.
4. **Tool allow-list per role** (config, not code-per-role): a simple map of
   `role → [allowed tool names]`, checked before every tool call, so adding
   a new tool later requires an explicit allow-list decision rather than
   being available by default.
5. **Technician-safe default**: a `technician` role chatting with JARVIS can
   ask about repairs/parts/warranty (their daily work) but the allow-list
   simply won't include financial or HR tools — same shape as their existing
   `ROLE_DEFAULT_MODULES`.
6. **No privilege escalation via chat**: JARVIS never runs with a "system"
   identity. Every tool call carries the asking user's session and is
   checked exactly as if that user had called the underlying REST endpoint
   directly.

---

## 8. Step-by-Step Implementation Roadmap

**Phase 0 — groundwork (no user-facing change)**
1. Add `pgvector` extension + the 5 new Prisma models (§5) as one additive
   migration. Run `prisma migrate dev` against a non-prod DB first.
2. Add `ANTHROPIC_API_KEY` (and embeddings provider key) to `.env.example`
   and deployment secrets. Confirm `@anthropic-ai/sdk` version compatibility.
3. Build `lib/jarvis/` module: `client.ts` (Anthropic client), `tools.ts`
   (tool registry + zod schemas), `permissions.ts` (role allow-list +
   wrappers around existing `hasModuleAccess`/`hasPermission`),
   `audit.ts` (writes `AiAuditLog`).

**Phase 1 — read-only MVP tools**
4. Implement `search-customers`, `check-inventory`, `explain-invoice`,
   `track-repair`, `check-warranty`, `summarize-sales`,
   `overdue-payments`, `procurement-summary` as thin wrappers calling
   existing REST endpoints server-side (with the user's session forwarded).
5. Wire `/api/jarvis/chat` with Claude tool-calling over that tool set.
   No document search yet, no drafting yet — just "ask questions about ERP
   data."
6. Add the chat panel UI (slide-over from Topbar), behind a feature flag /
   module-like gate so it can be enabled per role before company-wide
   rollout.

**Phase 2 — document intelligence**
7. Build the ingestion job (§6) and run it once against existing SOPs.
8. Add `search-documents` tool; extend chat to answer policy/product
   questions with citations.

**Phase 3 — drafting**
9. Add `draft-quotation` and `draft-message` tools (no send capability).
   Wire the chat UI so a returned draft opens the existing Quote
   modal / message compose UI pre-filled, never auto-submits.

**Phase 4 — pilot & hardening**
10. Pilot with director + one sales_rep + one technician account.
    Review `AiAuditLog` daily for the first two weeks.
11. Tune tool allow-lists, add missing tools based on real usage, add
    answer-confidence/"insufficient data" handling where gaps appear.

**Phase 5+ — explicitly deferred (per your instructions)**
12. Voice interface, WhatsApp-as-input-channel, autonomous financial
    actions, inventory forecasting models, executive dashboards,
    automation/agentic multi-step workflows. Each becomes its own scoped
    proposal once the MVP is stable in production.

---

## 9. Risks and Safeguards

| Risk | Safeguard |
|---|---|
| AI invents data (hallucinated numbers, fake customers) | Tool-calling only; chat layer forbidden from answering business-data questions without a tool/RAG result; "I don't know" is an acceptable answer. |
| AI bypasses business rules (e.g. creates an invoice with no approval) | JARVIS never calls write endpoints directly for financial/inventory/HR mutations in MVP; drafting only, human submits through existing UI. |
| Privilege escalation via natural language ("pretend you're a director") | Tool gating is server-side, keyed to the real session's role — prompt content cannot change `req.user`. |
| Prompt injection from ingested documents (a malicious SOP file instructing the model to ignore rules) | Treat retrieved document text as data, never as instructions, in the system prompt structure; never let tool/document content alter which tools are allowed. |
| Sensitive data leakage across roles (technician asking about payroll) | Module + permission allow-list checked per tool call, same as existing UI gating; row-level scoping by user where relevant. |
| Cost/latency blow-up (every chat message hitting Postgres + LLM) | Dedicated rate-limit bucket for `/api/jarvis/*` in `middleware.ts` (same pattern as existing buckets), conversation length caps, streaming responses. |
| Silent failures hiding bad AI output | Every tool call logged to `AiAuditLog` with allowed/denied + duration; surfacing in a simple admin view is a near-term follow-up. |
| Schema drift between `app_state` blob documents and ingested embeddings | Checksum-based re-ingestion (§5/§6) so stale embeddings are detected, not silently served. |
| Breaking existing modules | Zero edits to existing files/routes/models in MVP — only additive files, additive API routes, additive migration. Verified by code review diff being 100% new files plus one migration. |
| Over-trusting AI-drafted customer communication | Draft always opens in the existing compose/quote UI for human edit + the existing Send action — no new send path is created. |

---

## 10. Recommended First MVP

Scope, explicitly matching your constraints:

- **Chat panel inside the ERP** (slide-over from the Topbar), visible only
  to roles you enable it for initially (start with `director` only, expand
  after the pilot).
- **Read ERP data through approved, existing-endpoint-backed tools**:
  customers, inventory, invoices, repairs, warranty, sales summaries,
  overdue payments, procurement summary.
- **Document search** over existing SOP/policy documents with citations.
- **Draft-only generation**: quotation drafts and email/WhatsApp drafts,
  always handed to the existing UI for human review and the existing Send
  button — JARVIS never sends anything itself.
- **No autonomous financial actions.**
- **Every call session-authenticated, permission-checked, and logged** to
  the new `ai_audit_logs` table.
- **Zero changes to existing files** other than one additive Prisma
  migration and one new env var block.

This is deliberately small enough to ship, demo, and audit within the
existing architecture, while the tool/permission/audit scaffolding it
establishes is exactly what later phases (voice, WhatsApp-in, finance
intelligence, forecasting, exec dashboards) will plug into without rework.
