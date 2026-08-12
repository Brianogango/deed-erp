# Finance Phase 0 — Gap Matrix & Migration Risk Report

**Status:** Audit only — no accounting behaviour changes in this package.  
**Branch intent:** Document current state vs Odoo 18–style target (Deed ERP Finance Architecture Implementation Guide).  
**Date:** 2026-08-12  
**SoT model today:** Hybrid — live `deed_*` app_state blobs + Prisma dual-write (`lib/blob-cutover.ts`). Journals are dual-written (`deed_journalEntries` ↔ `journal_entries`).

Related: [Blob ↔ Prisma parity](./BLOB_PRISMA_PARITY.md) · [Finance sales seals](./FINANCE_SALES_SEALS.md) · [Finance officer guide](./USER_GUIDE_FINANCE_OFFICER.md) · [Invoice paid receipt automation](./INVOICE_PAID_RECEIPT_AUTOMATION.md)

---

## 1. Executive verdict

Deed already has **double-entry journals**, a **relational CoA**, **fiscal locks**, **payment allocations**, **valuation events**, and **append-only / reversal** journal patterns — but posting logic is **spread across many callers**, not a single `AccountingPostingService`. Live account codes **do not match** the guide’s suggested numbering; migration must **map**, not renumber blindly. Phase 1 should introduce a central posting engine behind a feature flag without changing operational CoA codes.

| Dimension | Verdict |
|-----------|---------|
| Double-entry present? | **HAVE** (balanced journals enforced in `journal-service`) |
| Single posting engine? | **MISSING** (builders in `store.tsx` + domain services) |
| Residuals / outstanding (not PAID flags alone)? | **PARTIAL** (allocations + invoice balances; no first-class outstanding receipt/payment docs) |
| Perpetual inventory / COGS? | **PARTIAL** (`valuation-service` + product avg cost; serial-level COGS incomplete) |
| Bank reconciliation depth? | **PARTIAL** (cashbook month recon UI; not statement-line matching engine) |
| Tax engine? | **PARTIAL** (Output VAT account + invoice VAT lines; no full tax report engine) |
| Report SoT? | **PARTIAL** (`gl-reports` on Prisma; UI still often blob-driven) |

---

## 2. Chart of accounts — map, do not renumber

Live template: `lib/accounting/coa-template.ts` (bootstrapped via `coa-bootstrap.ts` into `account_codes`).

| Role (guide concept) | Live code | Live name | Notes |
|----------------------|-----------|-----------|--------|
| Accounts receivable | **1800** | Accounts Receivable (Products) | Dynamic `ar` |
| Accounts payable | **3000** | Accounts Payable (Products) | Dynamic `ap` |
| GRNI / goods received not invoiced | **3201** | Accruals | Used as accrual/GRNI stand-in — confirm mapping before Phase 3 |
| Output VAT | **3301** | Output VAT Payable (16%) | Statutory |
| Customer deposits | **3100** | Customer Deposits | Layby / deposit cash |
| Customer credits | **3102** | Customer Credits | Credit notes / cancelled paid credits |
| Inventory | **1200** | Inventory | Closing / finished products |
| Revenue (products) | **5000** | Sales — Products (Invoices) | Dynamic `revenue` |
| COGS | **6001** | Cost of Goods Sold | |
| Bank (examples) | **2201 / 2202** | ABSA / Equity | Cash at bank |
| Cash / mobile | **2211** | Petty Cash / Mobile Money | |
| Employee reimbursements | **3105** | Employee Reimbursements Payable | |
| Equity / P&L | **4001–4003** | Share capital / RE / CY P&L | |

**Rule for later phases:** Keep live codes stable. Introduce an explicit `coa_role → code` map (config or table) so guide-named accounts resolve to Deed codes. Renumbering production CoA is a separate, high-risk ops project — out of scope until Finance signs off.

---

## 3. Posting path inventory (current)

There is **no** single `AccountingPostingService`. Callers build lines then persist via `createJournalEntry` / `persistStoreJournalEntry` / blob store mutations.

| Flow | Primary builder / caller | Persist path | Prisma mirror | Notes |
|------|--------------------------|--------------|---------------|--------|
| Customer invoice post | `lib/accounting/invoice-journals.ts` + store builders | Blob journals + `persistStoreJournalEntry` | Yes (idempotent ref) | AR / revenue / VAT |
| Invoice payment | `lib/accounting/payment-allocations.ts` + API routes | Allocations + journals | Payment + JE | Fiscal lock on APIs |
| Deposit / layby | `deposit-mirror.ts` + store `buildDepositPaymentJournal` | Blob + mirror | Partial | Liability **3100** |
| Customer credit / apply | store `buildCustomerCredit*` | Blob journals | Via mirror helpers | **3102** |
| Vendor bill / perpetual | `vendor-bill-perpetual.ts` | Domain + JE | Partial | GRNI/accrual path |
| Stock receipt / issue / adjust | `lib/inventory/valuation-service.ts` | `createJournalEntry` | Yes | Event-keyed; COGS/inventory |
| Reconfiguration | `lib/reconfiguration/service.ts` | `createJournalEntry` | Yes | Install / cost moves |
| FX revaluation | `lib/accounting/fx-journals.ts` | JE | Yes | |
| Expense approve / reimburse | store `buildExpense*` | Blob-first | Incomplete Prisma GL | Gap |
| POS sale | store POS journal builders | Blob-first | Incomplete | Gap |
| Buy-back / trade-in GL | store / aftersales paths | Blob-first | Incomplete | Gap |
| Manual / cashbook | Accounting + Cashbook UI | Blob recon + some JE | Bank recon mostly blob | |
| Journal reverse | `journal-service.reverseJournalEntry` | New JE + flags | Yes | Append-only pattern |

**Implication:** Phase 1 must wrap these callers behind one engine (same refs, same balance rules, feature-flagged dual path) before inventing new document types.

---

## 4. Gap matrix vs guide phases

Legend: **HAVE** · **PARTIAL** · **MISSING**

### Phase 0 — Audit & controls baseline (this doc)

| Item | Status | Evidence |
|------|--------|----------|
| Inventory of models / CoA / posting paths | **HAVE** | This document |
| Dual-write / SoT clarity | **PARTIAL** | `blob-cutover.ts`; journals dual_write; POs/serials/stock moves still blob_sot |
| Freeze new ad-hoc journal builders | **MISSING** | No policy gate yet — recommend after Phase 1 flag |

### Phase 1 — Central posting engine

| Item | Status | Evidence |
|------|--------|----------|
| `createJournalEntry` balance + fiscal lock + idempotent ref | **HAVE** | `lib/accounting/journal-service.ts` |
| Single AccountingPostingService / typed move API | **MISSING** | Logic in `store.tsx` + many services |
| Feature flag for engine cutover | **MISSING** | |
| Immutable posted entries (reverse only) | **PARTIAL** | Reversal helpers + FIN-001 invoice immutability; not all domains sealed |

### Phase 2 — Receivables / payables residuals

| Item | Status | Evidence |
|------|--------|----------|
| Payment ↔ invoice allocations | **HAVE** | `PaymentAllocation` model + `payment-allocations.ts` |
| Invoice residual / amount due | **HAVE** | Derived via `invoiceResidual` / `invoicePaymentStatus` (not stored PAID) |
| Outstanding customer receipts (unallocated cash) | **PARTIAL** | Phase 2: under-allocation + `GET ?outstanding=1` + allocate API; clearing **1805** when engine on |
| Outstanding vendor payments | **PARTIAL** | Same payment model with `direction:outbound` + clearing **3005** when engine on |
| Ageing reports | **PARTIAL** | `lib/accounting/ageing.ts` |

### Phase 3 — Purchases / GRNI / perpetual AP

| Item | Status | Evidence |
|------|--------|----------|
| Accrual / GRNI account in use | **HAVE** | Role `grni` → **3201**; valuation + vendor-bill-perpetual |
| Dedicated GRNI + 3-way match | **PARTIAL** | Server 3-way on bill post (`assert-bill-match.server`); PO still blob_sot; GRNI stays **3201** (mapped) |
| Vendor bill perpetual helper | **HAVE** | `vendor-bill-perpetual.ts` + `postVendorBill` when engine on |
| Input VAT role | **HAVE** | `input_vat` → **1150** |

### Phase 4 — Inventory valuation & COGS

| Item | Status | Evidence |
|------|--------|----------|
| Product average cost + valuation events | **HAVE** | `ProductValuation`, `ValuationEvent`, `valuation-service.ts` |
| Perpetual inventory JE on receipt/issue | **HAVE** | STK via `persistStockJournal` / engine when flagged; hooks when automated valuation on |
| Serial-level COGS / cost layer | **MISSING** / weak | Serials still largely blob_sot; COGS uses product avg |
| Stock moves Prisma SoT | **MISSING** | blob_sot lag |
| Engine-routed STK journals | **PARTIAL** | Phase 4: flag-gated `postStockJournal` |

### Phase 5 — Bank & cash

| Item | Status | Evidence |
|------|--------|----------|
| Cashbook UI + month bank recon | **HAVE** | `Cashbook.tsx` + store recon; finance seal |
| Statement line matching helpers | **HAVE** | `bank-statement-match.ts` + store auto-match |
| Statement import (OFX/CSV) | **MISSING** | Manual lines only |
| Bank charge / interest GL | **PARTIAL** | Phase 5 API when engine on (`6401` / `5105`) |
| Outstanding payments clearing via bank | **PARTIAL** | Suggest API links statement ↔ Phase 2 unallocated; allocate still via payments API |

### Phase 6 — Tax

| Item | Status | Evidence |
|------|--------|----------|
| Output VAT on invoices | **HAVE** | Account **3301** + invoice / posting-service lines |
| Input VAT on vendor bills | **HAVE** | Account **1150** via `input_vat` role |
| VAT control report (GL) | **HAVE** | Phase 6: `vat-reports` + `/api/accounting/vat-control` |
| Tax periods / eTIMS / remittance | **MISSING** | Return draft DTO only |

### Phase 7 — Expenses / POS / edge GL

| Item | Status | Evidence |
|------|--------|----------|
| Expense journals in store | **PARTIAL** | Blob builders; Prisma GL incomplete |
| POS journals | **PARTIAL** | Blob-first |
| Buy-back / aftersales GL completeness | **PARTIAL** | |

### Phase 8 — Analytics / management accounts

| Item | Status | Evidence |
|------|--------|----------|
| GL trial / ledger queries | **PARTIAL** | `gl-reports.ts` |
| Analytic accounts / tags / budgets | **MISSING** | |
| Unified P&L SoT (Prisma-only) | **MISSING** | UI still hybrid |

### Phase 9 — Hardening & cutover

| Item | Status | Evidence |
|------|--------|----------|
| Fiscal lock | **HAVE** | `FiscalLock` + `checkFiscalLock` / `assertFiscalPeriodOpen` |
| FIN-001 posted invoice immutability | **HAVE** | store API guards |
| Finance seals (bank recon, cancel, reimburse) | **HAVE** | `finance-controls.ts` |
| Payment receipt notify on paid | **HAVE** | invoice paid receipt automation |
| Certify / retire `deed_journalEntries` | **PARTIAL** | dual_write trackable; not certified |
| Single report SoT | **MISSING** | |

---

## 5. Controls already present (do not regress)

Preserve these while introducing the posting engine:

1. **Fiscal lock** — server gates on invoices, payments, journals (`fiscal-lock.server.ts`, journal-service).
2. **FIN-001** — posted invoice field immutability on store APIs.
3. **Payment allocations** — multi-invoice payment split with residual tracking foundation.
4. **Finance seals** — bank recon / cancel-reset / expense reimburse restricted to Finance/Director.
5. **Append-only journals** — reverse via new entry + `isReversed` / `reversalOfId`, not in-place edit.
6. **Valuation event keys** — idempotent inventory postings (`ValuationEvent.eventKey`).
7. **Journal ref idempotency** — `skipIfExists` dual-write safety.
8. **Paid-invoice receipt notify** — operational automation; keep behaviour when refactoring payment postings.

---

## 6. File-level impact map (for Phase 1+)

| Area | Paths | Change risk |
|------|-------|-------------|
| Posting core | `lib/accounting/journal-service.ts`, new `posting-service` (TBD) | High — must stay idempotent + balanced |
| Invoice / payment | `invoice-journals.ts`, `payment-allocations.ts`, `app/api/invoices/**`, `app/api/payments/**` | High — live AR cash |
| Store builders | `lib/store.tsx` (large journal builders) | High — migrate gradually behind flag |
| Inventory | `lib/inventory/valuation-service.ts` | Medium–high |
| Mirrors | `account-journal-mirror.ts`, `deposit-mirror.ts`, `holdover-mirror.ts`, `resolve-invoice-mirror.ts` | Medium |
| CoA | `coa-template.ts`, `coa-bootstrap.ts`, `liability-accounts.ts` | Low if map-only |
| Reports / UI | `gl-reports.ts`, `Accounting.tsx`, `Cashbook.tsx` | Medium — SoT clarity |
| Cutover | `lib/blob-cutover.ts` | Medium — certify journals only after parity |
| Schema | `JournalEntry*`, `AccountCode`, `PaymentAllocation`, `FiscalLock`, `Valuation*` | Additive preferred |

---

## 7. Top migration risks

| # | Risk | Why it hurts | Mitigation |
|---|------|--------------|------------|
| 1 | Blind CoA renumber | Breaks historical journals, labels, exports | Role→code map; never rewrite posted lines’ codes |
| 2 | Dual-write drift during engine cutover | Blob vs Prisma journal count/ID mismatch | Feature flag; `skipIfExists`; parity verify before certify |
| 3 | PAID flag vs residual amount diverge | Collections UI wrong; over/under allocation | Single residual helper; status derived from residual |
| 4 | GRNI on Accruals **3201** | Purchases/AP reports misclassified | Explicit map + optional new code only with Finance sign-off |
| 5 | Serial COGS vs product avg | Margin wrong on serial sales | Keep avg until serial SoT cutover; document limitation |
| 6 | Big-bang `store.tsx` rewrite | Regression across sales/POS/expenses | Strangler: engine first, one flow at a time |
| 7 | Report SoT split | Finance trusts wrong number | Declare Prisma GL as report SoT only after parity certificate |
| 8 | Fiscal lock bypass in new paths | Period reopen fraud / audit fail | All engine entrypoints call `assertFiscalPeriodOpen` |

---

## 8. Recommended Phase 1 entry (after approval of this matrix)

**Do not start coding Phase 1 until Finance/product approves this gap matrix.**

Suggested first slice:

1. Add `lib/accounting/posting-service.ts` (name flexible) that:
   - Accepts typed posting intents (invoice_post, payment_allocate, stock_move, reverse, …).
   - Resolves accounts via **role → live code** map.
   - Delegates persistence only to `createJournalEntry` (balance, lock, idempotency).
   - Does **not** change CoA codes or document UX.
2. Feature flag (env or settings) default **off**; when on, invoice post + payment allocate use the engine; blob dual-write unchanged.
3. Tests: unbalanced reject, fiscal lock 409, idempotent ref, allocation residual math.
4. Leave outstanding receipts/payments, tax engine, bank statement match, and CoA renumber for later phases.

---

## 9. Out of scope for Phase 0

- Any change to posting behaviour, CoA balances, or UI workflows.
- Contabo production data migration.
- Blob retirement of `deed_journalEntries`.
- Deploy of accounting code (docs-only package).

---

## 10. Sign-off checklist

- [ ] Finance owner agrees live CoA map (esp. AR **1800**, AP **3000**, GRNI→**3201**, VAT **3301**).
- [ ] Product agrees Phase 1 = engine + flag only (no outstanding docs yet).
- [ ] Eng agrees strangler migration of `store.tsx` builders (no big-bang).
- [ ] Parity job ownership for journals before any certify/retire.

When checked, open Phase 1 implementation on a new branch from `master`.
