# DeedERP Gap Remediation Plan

> Implementation plan for the findings in the "DeedERP vs Odoo ERP — Gap Analysis Report".
> Every item below was re-verified against the current codebase before planning. Several report
> findings are already partially or fully addressed; this plan reflects the **actual** remaining work.

---

## 0. Verified current state (corrections to the report)

The report was generated against an older revision. Re-audit results:

| Report finding | Report severity | Verified status today |
|---|---|---|
| L1 No double-entry journal engine | Critical | **Partially addressed.** `AccountCode`/`Journal`/`JournalEntry`/`JournalEntryLine` exist in Prisma; `lib/accounting/journal-service.ts` rejects unbalanced entries; invoice posting and invoice payments dual-write journals (`lib/accounting/invoice-journals.ts`). Trial Balance defaults to Prisma GL. **Remaining:** P&L / Balance Sheet / ageing / VAT still computed from invoice/expense arrays; GL tab reads blob journals; standalone `/api/payments` path bypasses GL. |
| L2 Dual persistence (JSON blobs + Prisma) | Critical | **Still true, but a cutover pattern exists** (`lib/blob-cutover.ts`, `BlobCutoverCertificate`, mirrors in `saveStoreKeys`). Blobs remain operational source of truth per `prisma/schema.prisma` note. |
| L3 Client-side stock operations | Critical | **Still true for quantities.** `validateDelivery` mutates `bulkStock`/`serials` in React state and appends blob stock moves. Valuation/COGS is already server-side (`lib/inventory/valuation-service.ts`); quantity moves are not. |
| L4 No stock reservation on SO confirm | Critical | **Partial.** Quote→SO conversion calls `reserveStock`; `confirmSO` creates a waiting delivery but reserves nothing. `StockReservation` model + mirror exist. |
| L5 No stock valuation engine | Critical | **Mostly addressed.** Weighted-average receipt/delivery valuation with COGS journals is live (`lib/inventory/valuation-math.ts`, `valuation-service.ts`, hooked into delivery-validate and receipt APIs). FIFO not implemented (acceptable — average is the configured default). |
| L7 Client-side document sequences | Critical | **Partial.** Atomic server counters exist for INV/SO/QUO/CLT (`lib/doc-ref-counter.ts`), repairs, deposits, ORC. `docSeq()` in `lib/store.tsx` still generates PO, REC, DN, CN, BILL, RCT and some in-store SO/QUO/INV paths. |
| L8 No payment allocation | Major | **Still true.** Prisma `Payment.invoiceId` is required 1:1; `PaymentAllocation` exists only as a TS type, not a table. |
| L9 Hardcoded approval thresholds | Major | **Partial.** `ApprovalRule` table + `/api/settings/approval-rules` + Settings editor exist; runtime (client and API) still uses hardcoded `APPROVAL_RULES` — `requiresApprovalAsync` is wired nowhere. |
| L10/F4 No 3-way PO matching, receipt→bill | Major | **Still true.** `POLine` has `qty`/`qtyReceived` but no `qtyBilled`; `createBillFromPO` bills everything received with no cross-validation. |
| L11 No pricelist engine | Major | **Mostly addressed.** `lib/pricing/pricelist.ts` + `PriceList`/`PriceListItem` tables exist and are wired into Sales + `confirmSO`; feature flag `salesPricelists` defaults **off**. |
| L12 No multi-currency | Moderate | **Partial.** `lib/currency.ts` + `ExchangeRate` table (rate snapshot per document). No FX journals — deliberate scope cut for now. |
| F3 Backorder logic not wired | Major | **Addressed.** `splitDeliveryForBackorder` is used inside `validateDelivery`; linked backorder deliveries are created. |
| F2 No auto cross-module documents | Critical | **Partial.** SO confirm → delivery note: done. PO confirm → receipt: done. Receipt → draft bill: still manual. SO → invoice: manual by design (gated on delivery). |
| F8 No fiscal period locking | Moderate | **Still true.** Only a bank-reconciliation month lock on cashbook edits; no journal/invoice period locks. |
| F12 Credit control advisory only | Critical | **Mostly addressed.** `confirmSO` hard-blocks overdue customers and routes credit-limit breaches through a blocking `credit_override` approval. Remaining: enforcement lives client-side in the store, not in the API. |
| L13 Module-level access only | Major | Still true. |
| L14 No optimistic locking | Moderate | Still true (last-write-wins on blob saves). |
| U1–U10, U14 UX findings | Various | Still true as described (breadcrumbs, chatter, smart buttons, interactive stepper, calendar/pivot, kanban DnD, dark mode, onboarding, form consistency, activities). |

**Strengths confirmed:** `odoo-sales-flow.ts` state machine, DataTable, GlobalSearch, design tokens, repair workflow + portal, Kenya payroll engine.

---

## Guiding principle for all phases

Nearly every remaining gap has the same root cause: **business rules execute in the browser against
JSON-blob state, and the server accepts whatever the client saves.** The existing pattern for fixing
this is already established in the codebase (server counters, journal dual-write, valuation hooks,
repair mirror, blob cutover certificates). Each fix below follows the same four-step recipe:

1. **Model** — add/confirm the Prisma table and migration.
2. **Server rule** — implement the invariant inside an API route / service within a `prisma.$transaction`.
3. **Client cutover** — make `store.tsx` call the API and treat the response as truth; keep the blob as a read mirror until certified.
4. **Backfill + certify** — backfill historical blob data, verify parity, flip source of truth, record a `BlobCutoverCertificate`.

---

## Phase 1 — Data integrity (P0)

### 1.1 Finish server-side document sequences (closes L7)

**Problem:** PO, REC/GRN, DN, CN, BILL, RCT numbers and some in-store SO/QUO/INV paths still come from
`docSeq()` (`lib/store.tsx` ~L3563), which counts client records — duplicates under concurrency.

**Work:**
- Extend `lib/doc-ref-counter.ts` kinds: `purchase_order` (PO), `goods_receipt` (REC), `delivery_note` (DN), `credit_note` (CN), `vendor_bill` (BILL), `receipt` (RCT).
- Add a small `POST /api/doc-refs` endpoint (auth-gated) that returns the next ref for a kind, so client-created blob documents can obtain atomic numbers even before their entity is fully API-backed.
- Update every `docSeq(...)` call site in `lib/store.tsx` to fetch from the counter API; keep `docSeq` only as an offline fallback that emits a clearly-marked provisional ref (`*-TMP-*`) which is replaced on save.
- Add unique constraints/indexes on the ref columns of `PurchaseOrder`, `DeliveryNote`, `CreditNote`, `Invoice`, `SaleOrder`, `Quote` (where not already present).
- Backfill counters from current max refs per kind (same approach `doc_ref_counter` used for INV/SO).

**Tests:** extend `__tests__/doc-ref-counter.test.ts` with the new kinds + a concurrency test (two parallel requests, distinct refs). 
**Acceptance:** no code path can assign a final document number client-side.

### 1.2 Server-side transactional stock quantities (closes L3, hardens F5)

**Problem:** Quantity mutations (delivery validate, receipts, transfers, adjustments) run in React state
and persist via blob saves; `/api/stock-moves` just appends to a JSON array. Two clients can both ship the last unit.

**Work:**
- New service `lib/inventory/stock-service.ts` with `applyStockMove({ productId, serialIds?, qty, from, to, reason, refType, refId })` executing inside `prisma.$transaction`:
  - decrement/increment `StockLevel` rows with `WHERE qty >= n`-style guarded updates (fail → 409),
  - transition `SerialNumber.status/location` with state validation,
  - insert a `StockMovement` row (source/destination locations, ref links),
  - invoke existing valuation hooks (`processStockReceipt` / `processStockDelivery`) in the same transaction.
- New/updated endpoints that call it: `POST /api/deliveries/[id]/validate` (extend the existing route that currently only posts valuation), `POST /api/receipts/[id]/validate`, `POST /api/inventory/transfers`, `POST /api/inventory/adjustments`.
- `lib/store.tsx`: `validateDelivery`, receipt validation, transfers and adjustments call these endpoints first and apply the *returned* state; remove direct `setBulkStock`/`setSerials` mutations for these flows. Delete the dead `confirmDeliveryWithStockDeduction`.
- Backfill: script to reconcile `StockLevel`/`SerialNumber` from `deed_serials` + `deed_bulkStock` blobs, then flip reads (`getStockByLocation`) to Prisma-backed data served with the app-state payload.

**Tests:** transaction-level oversell test (two concurrent validates on last unit → one 409); serial state-machine tests; parity test blob vs Prisma post-backfill. 
**Acceptance:** every stock quantity change corresponds to exactly one `StockMovement` row written server-side; overselling the same serial/unit is impossible.

### 1.3 Reserve stock on SO confirmation (closes L4)

**Problem:** `confirmSO` creates demand + a waiting delivery but reserves nothing; availability checks ignore other confirmed orders.

**Work:**
- In `confirmSO` (and the API-side SO confirm route), call `reserveStock` for each line (pattern already exists in quote→SO conversion, `lib/store.tsx` ~L7740) — server-side via a `POST /api/sale-orders/[id]/reserve` that writes `StockReservation` rows in the same transaction as the status change.
- Available-to-promise: `calcStockByLocation` minus active reservations; surface "Available / Reserved" in Sales and Inventory views.
- Release reservations on SO cancel and consume them on delivery validate (link `StockReservation → StockMovement`).
- Partial availability: reserve what exists, flag the SO line as `backorder_pending` (backorder machinery from `splitDeliveryForBackorder` already handles the delivery side).

**Tests:** confirm two SOs against one unit → second gets partial/none; cancel releases; delivery consumes. 
**Acceptance:** a confirmed SO's stock cannot be promised to another order.

### 1.4 Fiscal period lock dates (closes F8)

**Problem:** Any user can post/edit financial documents at any date; only cashbook has a recon month lock.

**Work:**
- Add `lockDate` and `taxLockDate` columns to `CompanySetting` (simpler than a full `FiscalPeriod` table and covers the Odoo behaviour that matters: "no postings on/before this date").
- Enforce in one place: `createJournalEntry` / `reverseJournalEntry` in `lib/accounting/journal-service.ts` reject entries dated on/before the lock (409 with clear message); invoice post, payment register, credit note, and stock-valuation routes all flow through it already or will after 1.2.
- Settings UI: date pickers under Accounting settings, editable by finance/director roles only; changes audit-logged via `lib/finance-audit.ts`.
- Year-end closing action (second step): "Close fiscal year" wizard that posts the P&L-to-retained-earnings entry via the journal service, then advances `lockDate`.

**Tests:** posting before lock rejected; on/after allowed; role gate on changing lock. 
**Acceptance:** no journal-affecting mutation can land in a locked period.

### 1.5 Journal-driven financial reports (finishes L1/F1/F11)

**Problem:** Trial Balance already reads Prisma GL, but P&L, Balance Sheet, ageing and VAT are still summed from invoice/bill/expense arrays in `components/modules/Accounting.tsx` (~L1421–1495), and `GeneralLedgerTab` reads blob journals.

**Work:**
- Extend `hooks/usePrismaAccountingReports.ts` + `app/api/accounting/*` with P&L and Balance Sheet endpoints aggregating `JournalEntryLine` by account class/date range (same pattern as trial-balance route).
- Point `GeneralLedgerTab` at the Prisma journals API instead of `AccountingContext` blob state.
- Close the GL bypasses: standalone `/api/payments` (blob) path must also post payment journals, or be folded into `/api/invoices/[id]/payments`; expenses and payroll runs post journals via `journal-service` using the `product-accounts.ts` / payroll account mapping (salary expense / statutory payables).
- Backfill: one-off script replaying historical posted invoices/payments/expenses/payroll into journal entries (idempotent on `ref`, the journal service already supports this), then reconcile blob-P&L vs GL-P&L and keep the blob view behind a "legacy" toggle until parity is signed off.

**Tests:** P&L/BS endpoint aggregation tests; parity test legacy vs GL on seeded data; payroll/expense posting tests. 
**Acceptance:** every figure on TB/P&L/BS drills down to journal entries; debits always equal credits.

### 1.6 Payment allocation table (closes L8)

**Problem:** Prisma `Payment.invoiceId` is required 1:1; splitting a payment across invoices only exists in client blob state.

**Work:**
- Migration: new `PaymentAllocation` table (`paymentId`, `invoiceId`, `amount`, timestamps; unique `(paymentId, invoiceId)`); make `Payment.invoiceId` optional; backfill one allocation row per existing payment.
- `POST /api/payments` (relational version) accepts `allocations: [{invoiceId, amount}]`, validates Σ ≤ payment amount and per-invoice residual, writes payment + allocations + the payment journal in one transaction.
- Residual/status: move `invoiceResidual` / `invoicePaymentStatus` inputs to allocation sums; keep the pure functions in `odoo-sales-flow.ts` unchanged (they take arrays).
- UI: payment registration modal gains a multi-invoice allocation grid (default: single invoice pre-filled, so the common path is unchanged).

**Tests:** over-allocation rejected; multi-invoice allocation updates both residuals; journal posted once per payment. 
**Acceptance:** one payment can settle N invoices with a traceable allocation trail.

---

## Phase 2 — Workflow enforcement and completion (P1)

### 2.1 Enforce DB-backed approval rules server-side (closes L9, hardens F12)

- Wire `requiresApprovalAsync` / `getApprovalRoles` (`lib/sales-approval-rules.server.ts`) into the SO confirm / discount / credit-override API paths so the DB `ApprovalRule` thresholds are authoritative; hardcoded `APPROVAL_RULES` becomes seed data + client-side *preview* only.
- Move the credit gate from `confirmSO` in `store.tsx` into the SO confirm API route (client keeps the same UX; server rejects unapproved confirms with 403 + approval-request id).
- Tests: change a threshold via `/api/settings/approval-rules`, verify enforcement changes without redeploy; bypass attempt via direct API rejected.

### 2.2 Receipt → draft bill + 3-way matching (closes L10/F4)

- Add `qtyBilled` to PO lines (blob type + `PurchaseOrderItem` column).
- On receipt validation, auto-create a **draft** vendor bill pre-filled from received quantities (`createBillFromPO` becomes the engine, invoked automatically; keep a setting to disable).
- Bill posting validates per-line: `qtyBilled + thisBill ≤ qtyReceived` (block) and price vs PO price beyond tolerance (warn/approval). Surface a matching status chip (Matched / Partially billed / Over-billed) on `PurchaseOrdersTab` and `POFormView`.
- Tests: over-billing blocked; billing before receipt blocked; partial receipts chain correctly.

### 2.3 Blob → Prisma cutover, next tranche (progresses L2)

Using the existing cutover machinery, promote to Prisma source-of-truth (in order): payments/allocations (after 1.6), stock levels + serials + movements (after 1.2), deliveries, expenses, purchase orders/receipts/bills. Each gets: backfill script → parity check → `BlobCutoverCertificate` → reads flipped → blob writes stopped. `store.tsx` shrinks correspondingly (target: pure view-model + API client per domain).

### 2.4 Optimistic locking on shared documents (closes L14)

- Add a `version` (or reuse `updatedAt`) check on save for API-backed entities: client sends the version it loaded; mismatch → 409 with the server copy so the UI can show a "record changed, review and retry" merge prompt.
- For blob keys, `saveStoreKeys` already merges append-only journals; add per-key `updated_at` compare-and-set for the high-risk keys (sale orders, invoices, purchase orders) until they're cut over.

### 2.5 Enable pricelists in production (closes L11)

- Backfill `PriceList`/`PriceListItem` from current price fields, assign default pricelists to customer segments, flip `salesPricelists` default to on, and remove the dead `newPricelist` text field in `Sales.tsx`.

### 2.6 Activities + chatter foundation (closes U2, U14 — the two big UX gaps)

- **Model:** generalize what already exists — repairs' `MessageThread` and CRM's `opportunityActivities` — into two polymorphic Prisma tables: `DocumentMessage` (`entityType`, `entityId`, `authorId`, `body`, `kind: comment|state_change|system`) and `Activity` (`entityType`, `entityId`, `type: call|meeting|todo|email`, `dueDate`, `assigneeId`, `status`).
- **API:** `GET/POST /api/chatter/[entityType]/[entityId]`; state-change events auto-logged from the workflow transitions (SO confirm, invoice post, PO receive…) — one `logStateChange()` call in each existing transition point.
- **UI:** one `<ChatterPanel />` component (messages + activities + log, mention support later) mounted on SO, PO, invoice, and repair form views; an "Activities" cross-module list view with overdue highlighting; due-activity badge in the Topbar.
- Migrate repairs `MessageThread` and CRM activities onto the shared tables to avoid two systems.

---

## Phase 3 — UX parity (P2)

Ordered by effort-to-value; each is independent.

1. **Breadcrumbs / view stack (U1):** a `NavigationStackProvider` recording `{module, view, recordRef}` pushes; render a clickable trail in `Topbar.tsx`. Modules keep their internal `useState` views but report pushes to the provider — no router rewrite required.
2. **Smart buttons (U3):** a `RelatedDocsHeader` component on form views showing counts (deliveries, invoices, payments, returns for an SO; orders for a customer) with click-through to pre-filtered lists. Data comes from the same store selectors used inline today.
3. **Interactive status bar (U5):** extend `StatusStepper` with an `onStepClick` that invokes the mapped transition (with confirm dialog + server validation); wire for SO, PO, invoices, repairs. The transitions already exist as store/API actions — this is a UI affordance, not new logic.
4. **Record-level access rules (L13):** add a `recordScope` concept per module in role settings (`all | own | team`); enforce server-side in list/read APIs (filter by `salespersonId`/`createdById`) and in `visibleDashboardSalesOrders`-style selectors client-side. Start with Sales, CRM, HR/payroll.
5. **Consistent form pattern (U10) + monolith decomposition (U4):** adopt the Purchase-module pattern (`POFormView`, tab components, context) as the standard; split `Inventory.tsx` (3,511 lines) and `Sales.tsx` (2,523 lines) into `*FormView` / `*ListView` / tab files with a shared `FormShell` (header status bar + smart buttons + body sections + chatter). Do this opportunistically as each module is touched by Phase 1/2 work rather than as a big-bang refactor; remove `@ts-nocheck` from `Dashboard.tsx`/`Repair.tsx` as they are touched.
6. **Kanban drag-and-drop (U7):** add `@dnd-kit` to `PipelineKanban.tsx`; drop → existing stage-change action.
7. **Dark mode (U8):** add `[data-theme="dark"]` token overrides in `globals.css` (the token system is ready), a Topbar toggle persisted per user, and `prefers-color-scheme` default.
8. **Onboarding checklist (U9):** post-setup-admin dashboard card driven by real completion checks (company settings, CoA seeded, first product, first customer, bank account) linking to each setup screen.

## Phase 4 — Deferred (P3, do when business needs them)

- **Bank reconciliation (L6):** CSV/OFX statement import table (`BankStatementLine`), auto-match suggestions against Prisma payments, manual match UI, reconciled flag feeding the existing cashbook lock. Depends on 1.6.
- **Calendar + pivot views (U6):** calendar for deliveries/repair appointments/leave; pivot for sales analysis on top of DataTable's grouping.
- **Expense approval workflow (F6):** submit → manager approve → finance post (posting hits the journal engine from 1.5); reuse the approval-rules table from 2.1.
- **Lead/opportunity split (F7):** add `isLead` + conversion action with duplicate check on `Opportunity`.
- **FX journals / full multi-currency (L12):** only if international volume materializes; `ExchangeRate` snapshotting already covers document capture.
- **FIFO valuation:** only if average costing proves insufficient; `InventoryBatch` table already exists.

---

## Sequencing and dependencies

```
1.1 sequences ──────────────┐
1.2 stock service ─→ 1.3 reservations ─→ 2.2 receipt/bill matching
1.4 lock dates ──→ 1.5 GL reports ←─ 1.6 payment allocation
2.1 approval enforcement (independent)
2.6 chatter (independent) ─→ 3.x UX items (independent of each other)
2.3 blob cutover (continuous, follows each domain's server-side migration)
```

Phase 1 items are the load-bearing changes: they are invasive in `lib/store.tsx` and the API layer,
must ship with backfill scripts and parity checks, and everything later builds on them. Phase 2 items
are mostly additive server logic. Phase 3 is UI-layer only.

## Testing and rollout discipline (applies to every item)

- Unit tests colocated in `__tests__/` following existing patterns (vitest); concurrency-sensitive items (sequences, stock, reservations) get explicit parallel-request tests.
- Every schema change ships as a Prisma migration plus an idempotent backfill script in `scripts/`.
- Every source-of-truth flip is preceded by a parity report and recorded via `BlobCutoverCertificate`.
- Feature flags (existing `systemSettings` pattern) gate user-visible behaviour changes: reservations, auto-bill, chatter, dark mode, record scoping — so each can be enabled per rollout stage.
