# Deed ERP — Known Issues and Technical Debt

| | |
|---|---|
| **Document** | Known Issues and Technical Debt (supporting document to [`DEED_ERP_SYSTEM_DOCUMENTATION.md`](./DEED_ERP_SYSTEM_DOCUMENTATION.md)) |
| **Repository / branch / commit reviewed** | `brianogango/deed-erp` · `claude/focused-einstein-lqo6u8` · `1713b7bf39c24703b8f5ab986104868d9de89b87` |
| **Review date** | 2026-10-01 |
| **Method** | Static reading of the code paths cited per issue. **Nothing was executed**: the application was not run, no production data was inspected, and the test suite could not be run (see main document §19). Each issue is therefore a *code-level finding*; "Impact" describes what the code allows, not an observed incident. Items needing runtime or production confirmation say so. |
| **Severity scale** | **Critical** — remotely exploitable without authentication, or silent corruption of the books with no detection. **High** — financial integrity or access-control failure reachable by an authenticated user, or a control that can be bypassed. **Medium** — control weakness, drift risk or defect with a workaround/detection. **Low** — hygiene or documentation. |

**Result of the review: no Critical finding was verified.** Authentication is required for every non-public route, the public routes examined authenticate themselves or are low-impact, and posted-journal creation is validated server-side. There are, however, **ten High findings** (KI-01 to KI-10) that weaken financial or access controls and should be scheduled first.

## Index

| ID | Severity | Module | Title | Changes business logic? |
|---|---|---|---|---|
| KI-01 | High | Platform | Multiple sources of truth; dual-writes are fire-and-forget; default store backend is the legacy `app_state` | No (architecture) |
| KI-02 | High | Finance | Invoice GL posting is best-effort after commit — posted invoice can have no journal | Yes (changes failure behaviour) |
| KI-03 | High | Finance / Purchase | Vendor-bill payments post Dr cash / Cr AR (no AP branch) | Yes (corrects posting) |
| KI-04 | High | Delivery / Inventory | Delivery validation has no role gate; valuation failure after stock deduction is swallowed | Yes |
| KI-05 | High | Delivery / Repair | `PATCH /api/outbound-releases/[id]` writes the raw body to the release | No (security) |
| KI-06 | High | Finance | `system-journals` accepts caller-supplied accounts/lines | Yes |
| KI-07 | High | POS | POS posting is client-orchestrated and non-atomic; journal totals/accounts are client-supplied | Yes |
| KI-08 | High | Platform / Finance | Read endpoints on Prisma-backed documents are session-only (invoices, deposits, quotes, purchase orders, leads, contacts, products incl. `costPrice`) | No (security) |
| KI-09 | High | Finance | Fiscal-lock/period controls: lock can be moved back unaudited; reopen does not lower the lock; no UI | Yes |
| KI-10 | High | Contacts | Any authenticated user can edit or delete any company/customer (including credit limit) | No (security) |
| KI-11 | Medium | Finance | Immutability and audit-log integrity are application-level only | No |
| KI-12 | Medium | Platform | Document numbering has client-side fallbacks, derived references and blob-seeded counters | Yes |
| KI-13 | Medium | Security | Module access not enforced on pages; store ACL references non-existent modules | No |
| KI-14 | Medium | Repair / Inventory | Client-side-only business rules; repair state machine enforced for 5 target statuses | Yes |
| KI-15 | Medium | Platform | Advisory lock fails open; read-modify-write on whole collections | No |
| KI-16 | Medium | Bank | Bank reconciliation is client-side; Prisma statement APIs have no UI | Yes |
| KI-17 | Medium | Settings | `POST /api/settings` mass-assigns the request body | No |
| KI-18 | Medium | Payments | M-Pesa callback unauthenticated; success does not create a payment; STK push open to every role | Yes |
| KI-19 | Medium | Security | CSRF relies on SameSite + Origin heuristics; CSP allows `unsafe-inline` | No |
| KI-20 | Medium | Security | MFA enforcement is an env flag; production value unverifiable | No |
| KI-21 | Medium | Security | Rate limiting falls back to per-process memory | No |
| KI-22 | Medium | Repository | Stray/dead files incl. a hard-coded-credential handler, tarballs, 676 KB dev log | No |
| KI-23 | Medium | Operations | No Prisma migration history; migrations applied after deploy; `db push --accept-data-loss` in CI | No |
| KI-24 | Medium | Build | `npm ci` fails; two lockfiles; dependency pulled from a CDN tarball | No |
| KI-25 | Medium | Data model | 25 schema models with no ORM usage | No |
| KI-26 | Medium | Platform | Dead or disconnected endpoints (49 with no in-repo caller; `/api/pos/charge` cannot work) | No |
| KI-27 | Medium | Finance | Two integrity gates cannot fail; gate labels cite superseded accounts | Yes |
| KI-28 | Medium | Inventory / Finance | Costing fallbacks: FIFO shortfall auto-covered at standard cost; heuristic bank/account mapping | Yes |
| KI-29 | Medium | Modules | E-commerce is UI-only; Kilimall has no marketplace integration | No |
| KI-30 | Low | Documentation | README and several docs contradict the code | No |
| KI-31 | Medium | Operations | Backups only pre-deploy, no retention/off-site evidence; no monitoring/alerting | No |
| KI-32 | Medium | Quality | Test coverage is thin on routes and on the browser store; E2E covers 5 flows | No |
| KI-33 | Medium | Platform | Legacy client journal blob still written; retirement flags default off | No |
| KI-34 | Low | Auth | Three alias tables, three role lists; Prisma `UserRole` enum diverges | No |
| KI-35 | Medium | Customer portal | Public endpoints rely on phone/ref verification and rate limits | No |
| KI-36 | Low | Security | Placeholder users in `lib/auth/public-users.ts`; visual-regression bypass | No |
| KI-37 | Medium | Finance | Payment-route segregation-of-duties check swallows errors | No |
| KI-38 | Medium | Finance | Payments: `PAY/<uuid8>` references, unused `RCT` counter, no void path | Yes |
| KI-39 | Medium | Finance | Credit notes always reverse revenue on 5000 regardless of the original revenue accounts | Yes |
| KI-40 | Medium | Security | 9 named permissions are never enforced; no API route exists for reconfiguration reversal | Yes |

---

## High severity

### KI-01 — Multiple sources of truth; fire-and-forget dual-writes; legacy default backend
- **Description.** The browser holds whole collections (`lib/store.tsx`) and writes them back through `POST /api/store`. Domains are split across `app_state` (default), `erp_state_*` projection, `store_records`, Prisma tables and the object store. After saving a collection the server mirrors it to Prisma with `void import(...).then(...).catch(console.error)` (accounts, journals, reservations, deposits, holdovers, deliveries, purchase orders, serials, stock moves, receipts). A failed mirror is logged and forgotten.
- **Evidence.** `lib/store-backend.ts` (`STORE_BACKEND` default `app_state`), `lib/server-store.ts` `saveStoreKeys`, `lib/domain-source-of-truth.ts` (declares Prisma as SoT but nothing enforces it), `docs/PRISMA_STATE_CUTOVER.md` (the 2026-09-21 incident), `docs/DATA_SAFETY_MIGRATION.md` (claims `STORE_BACKEND` defaults to `prisma` — contradicted by code).
- **Impact.** Stock (`deed_serials`, `deed_stockMoves`, `deed_receipts`, `deed_deliveries`) can differ between blob and Prisma; reports built from Prisma (valuation, GL) can disagree with screens built from the blob. Whole-array saves from a stale tab can overwrite concurrent edits (mitigated by merges, bulk-delete guard and `If-Match`, not eliminated).
- **Remediation.** Finish the cutover per `docs/PRISMA_STATE_CUTOVER.md`; give each remaining domain a dedicated REST route (purchase orders, receipts, serials, stock moves, deliveries first); make mirrors transactional or queue them (`BackgroundJob`); add a parity job that alerts.
- **Dependencies.** KI-12, KI-33. **Changes business logic?** No.

### KI-02 — Invoice GL posting is best-effort after commit
- **Description.** `PUT /api/invoices/[id]` commits the status change (`approved`, `postingStatus='posting'`) in a Serializable transaction, then creates the journal, `TaxTransaction` rows and `postingStatus='posted'` outside it; on failure it logs and sets `postingStatus='unposted'` while the invoice stays posted.
- **Evidence.** `app/api/invoices/[id]/route.ts` (comments "GL / tax subledger stay best-effort", `console.error('[invoice] GL journal for confirm failed — invoice stays posted:')`); detection gate `invoices_without_journal`; repair route `POST /api/accounting/orphaned-invoice-journals`.
- **Impact.** Revenue, AR and output VAT can be missing from the ledger while the customer holds a posted invoice; VAT returns built from `TaxTransaction` can also omit it. Month-end blocks (good), but only if someone runs the suite.
- **Remediation.** Post invoice + journal + tax rows in one transaction, or set the invoice `posted` only after the journal exists (outbox pattern: `AccountingOutbox` model exists but is unused). Alert on `postingStatus='unposted'` older than minutes.
- **Dependencies.** Chart-of-accounts completeness (unknown/inactive account errors are what trigger it). **Changes business logic?** Yes — failure behaviour changes from "confirm succeeds" to "confirm fails or retries".

### KI-03 — Vendor-bill payment journal has no AP branch
- **Description.** `POST /api/invoices/[id]/payments` builds `Dr cash/bank … Cr 1800 AR` unconditionally. The Finance → Bills bulk-pay action calls `registerPayment` for vendor bills, which calls this route. The correct vendor-direction builders exist (`buildInvoicePaymentLines`/`postInvoicePayment` with `isVendor`, `postInvoicePaymentJournalToPrisma`) but are not used here.
- **Evidence.** `app/api/invoices/[id]/payments/route.ts` (journal lines), `components/modules/Accounting.tsx` (bulk pay, `registerPayment(b.id, …)` on the `bills` tab), `lib/store.tsx` `registerPayment`, `lib/accounting/posting-service.ts`. *Runtime confirmation required:* query `journal_entries` with `source_type='payment'` joined to `invoices.document_type='vendor_bill'` and look for credits to 1800.
- **Impact.** AP remains overstated and AR understated (credit to 1800) for paid bills in the Prisma GL, which is the reporting source; the AR/AP integrity gates (`ar_vs_gl`, `ap_vs_gl`) should flag it.
- **Remediation.** Branch on `documentType`/blob type: Dr 3000 AP / Cr cash for vendor bills (reuse `buildInvoicePaymentLines`); add a test; produce a correcting journal list for existing bills.
- **Dependencies.** Data correction by Finance. **Changes business logic?** Yes (corrects posting).

### KI-04 — Delivery validation: no role gate and swallowed valuation failure
- **Description.** `POST /api/deliveries/[id]/validate` requires only a session. It deducts stock and then calls `postDeliveryValuationFromPayload`; an exception is caught and returned as `valuation:{ok:false}`, and the delivery is saved `done`.
- **Evidence.** `app/api/deliveries/[id]/validate/route.ts`; `lib/inventory/valuation-hooks.ts` (`isFinanceSetupGap`, "must not reverse stock").
- **Impact.** Any role (including technician) can mark deliveries done and move serials to `sold`; COGS can be missing for delivered goods (inventory 1200 overstated, margin overstated). The route's own comment says setup gaps are deliberately non-fatal.
- **Remediation.** Gate with `manageDeliveries`/`approveInventory`-style roles; record a durable "valuation pending" flag and retry job instead of swallowing; show it in the integrity suite (`inventory_vs_gl` helps).
- **Dependencies.** KI-01. **Changes business logic?** Yes.

### KI-05 — `PATCH /api/outbound-releases/[id]` accepts the raw body
- **Description.** The handler calls `prisma.outboundRelease.update({ where:{id}, data: body })` after `getRequiredSession()` only.
- **Evidence.** `app/api/outbound-releases/[id]/route.ts` (`PATCH`). The UI never calls it (only `/pick`, `/verify`, `/release`, `/void`, `/audit-log`).
- **Impact.** An authenticated user can set `status`, verification/authoriser fields, or foreign keys directly, bypassing the ORC verification roles (DIR/ADM) and audit log.
- **Remediation.** Delete the route or restrict to a whitelisted field set and role; add a test.
- **Changes business logic?** No.

### KI-06 — `system-journals` trusts caller-supplied lines and accounts
- **Description.** Authorisation reuses the write ACL of a "governing" store key. The six `kind`s map to keys writable by broad role sets (e.g. `invoice_adjustment` → `deed_invoices`: finance, sales_rep, technical_lead with sales/accounting/repair modules; `pos_session` → `deed_posSessions`: finance, sales_rep, kilimall). Accounts and amounts are accepted as supplied; only balance, account validity and fiscal lock are checked.
- **Evidence.** `app/api/accounting/system-journals/route.ts`, `lib/auth/store-write-policy.ts`.
- **Impact.** A sales rep with the sales module can post a balanced journal to any active account with source `invoice`. The posted entry is permanent (reversal required).
- **Remediation.** Derive lines server-side from the governing record (as invoices and payments do); or restrict to DIR/FIN; require `invoiceId`/source existence.
- **Changes business logic?** Yes.

### KI-07 — POS posting is client-orchestrated; `post-sale-journal` trusts client totals
- **Description.** `createPOSOrder` performs stock → ticket → invoice → journal as separate browser calls. `POST /api/pos/post-sale-journal` takes `total, subtotal, tax, revenueLines[].account, amount` from the request body without recomputing from the invoice/lines.
- **Evidence.** `lib/store.tsx` `createPOSOrder`, `app/api/pos/post-sale-journal/route.ts`, `lib/accounting/pos-journal-gaps.ts`, integrity gate `pos_sales_without_journal` (its own comment cites KES 78,000 of POS sales outside the ledger for six weeks).
- **Impact.** A failed or tampered call yields a sale without GL or with arbitrary revenue split; the till is also exposed to partial failure between steps.
- **Remediation.** Single server endpoint `POST /api/pos/sales` that computes totals, creates ticket, invoice, stock, valuation and journal in one transaction (Prisma `PosSession`/`PosTransaction` models exist, unused).
- **Dependencies.** KI-01, KI-26. **Changes business logic?** Yes.

### KI-08 — Read endpoints on Prisma-backed documents have no role filter
- **Description.** The list/detail `GET` handlers for invoices (`/api/invoices`, `/api/invoices/[id]`, `/api/invoices/stats`), deposits, quotes, purchase orders, leads, contacts, products, expense receipts, settings and others call `getRequiredSession()` and nothing else. The role-sliced views implemented for `/api/store` (`filterStoreValueForRole`: e.g. technicians see only repair-linked invoices, sales reps only customer invoices) are **not** applied to these routes. `GET /api/products` returns raw `Product` rows including `costPrice` and (non-lite) serial rows.
- **Evidence.** `app/api/invoices/route.ts` `GET`; `app/api/deposits/route.ts` `GET`; `app/api/products/route.ts` `GET`; `app/api/quotes/[id]/route.ts` `GET`; `app/api/purchase-orders/route.ts` `GET`; `lib/auth/authorization.ts` `invoiceSliceForRole`; the 68 "session-only (no role check)" rows in the API reference.
- **Impact.** Any authenticated user (including a technician) can read all customer and vendor financial documents, customer deposits, purchase costs and margins by calling the API directly, defeating the UI-level and store-level confidentiality design (and the unused `viewPurchaseCost` permission, KI-40).
- **Remediation.** Apply the same row slice/role gate to the REST reads; strip cost fields unless `viewPurchaseCost`; add tests per role.
- **Changes business logic?** No (access control).

### KI-09 — Fiscal lock and period controls
- **Description.** (a) `PUT /api/accounting/fiscal-lock` lets DIR/FIN set any date (including earlier) with no audit event. (b) `reopen` sets the period `open` but leaves `FiscalLock.lockDate`, which `journal-service` checks first. (c) Fiscal periods, lock and close/reopen have no UI. (d) `DELETE /api/invoices/[id]` (void) has no fiscal-lock check; the reversal journal is dated *now*.
- **Evidence.** `app/api/accounting/fiscal-lock/route.ts`, `fiscal-periods/[id]/reopen/route.ts`, `lib/accounting/journal-service.ts` `assertFiscalPeriodOpenWith`, `app/api/invoices/[id]/route.ts` `DELETE`.
- **Impact.** Closing controls are operable only by API; a finance user can silently re-open history; a reopened period is not actually postable.
- **Remediation.** Single "reopen" operation that lowers the lock under Director approval with audit; add UI; require period-lock check for void.
- **Changes business logic?** Yes.

### KI-10 — Companies/customers editable or deletable by any session
- **Description.** `PUT/DELETE /api/companies/[id]` (and similar contact-person routes) check only `getRequiredSession()`; the handler updates `creditLimit`, tax PIN, etc. and `prisma.client.delete`.
- **Evidence.** `app/api/companies/[id]/route.ts`, `app/api/contact-persons/**`.
- **Impact.** Credit-limit and customer-master tampering by any role; hard delete of a client with documents depends on FK `RESTRICT` (not verified per relation).
- **Remediation.** Require `manageMasterData`/CRM roles; use archive instead of delete; audit master-data changes.
- **Changes business logic?** No.

## Medium severity

### KI-11 — Immutability and audit integrity are application-level only
- **Evidence.** No DB triggers/constraints on `journal_entries`, `journal_entry_lines`, `audit_logs`, `financial_audit_events` in `database/migrations/` or `prisma/migrations/` (only `app_state` and notification triggers). Immutability = no update/delete code path plus reversal workflow. The store audit timeline is capped (`MAX_AUDIT_ROWS=600`, overflow archived).
- **Impact.** A DBA/compromised app role can alter the ledger or audit rows silently.
- **Remediation.** `REVOKE UPDATE, DELETE` for the app role on those tables (or triggers that raise), row hash chain on `financial_audit_events` (`monetaryHash` column exists, unused for chaining). **Changes business logic?** No.

### KI-12 — Document numbering
- **Evidence.** `lib/doc-ref-counter.ts` (atomic per-prefix-per-year counter in `doc_ref_counter`; seeded on first use from existing rows **and from blobs** for PO/DN/REC/credit/bill), `lib/doc-numbers.ts` (`allocateDocNumberSync` localStorage fallback used by `store.tsx` `allocateDocRef` when the API fails), `app/api/payments/route.ts` (`PAY/<8 hex of uuid>`), `lib/store.tsx` `seq()` (per-browser `localStorage` counters `deed_seq2_<key>` for 25 prefixes incl. stock transfers `TR`, adjustments `ADJ`, expenses `EXP`, RMA, buy-backs, warranties, Kilimall `KO/KS/KD`), `lib/repair-ref.ts` (random), `app/api/doc-numbers/route.ts` (does not list `payment_receipt`; no code allocates `RCT`), `lib/accounting/posting-service.ts` (`JRN/PAYALC/<ref>/<Date.now() base36>`).
- **Impact.** Collisions are DB-prevented for quotes, sale orders, invoices, POs, GRNs, delivery notes, credit notes, repairs, journals, deposits, reconfigurations (unique constraints). They are **not** DB-prevented for blob-only documents (stock transfers, adjustments, expenses, RMAs, buy-backs, warranties, Kilimall documents, POS tickets until invoiced, delivery jobs, payments), and the `seq()` counters are per browser, so two users can mint the same `TR`/`ADJ`/`EXP` number — a fallback number can duplicate; two `QUO` series (CRM quote vs quotation-state SO) share one counter by design.
- **Remediation.** Remove the client fallback (fail instead), add unique columns/constraints for payments and transfers, retire blob seeding once Prisma is complete. **Changes business logic?** Yes (numbering behaviour).

### KI-13 — Module access and store ACL
- **Evidence.** Pages are gated only by session (`app/(app)/layout.tsx`); `STORE_WRITE_POLICIES` requires modules `settings` and `property`, which are not in `MODULE_IDS` (`lib/auth/types.ts`) — non-directors can never satisfy them (`deed_companySettings`, `deed_systemSettings`, `deed_companyAssets`).
- **Impact.** URL access to any module screen; admin officers silently cannot save company settings or assets through the store although role matrices say they can.
- **Remediation.** Server-side module guard in a shared layout/route handler; fix module names. **Changes business logic?** No (aligns code with documented roles) — confirm intended behaviour with the business first.

### KI-14 — Client-side-only rules and staged repair state machine
- **Evidence.** `lib/store.tsx` repair actions (role/assignee checks), `lib/repair-transition-guard.ts` (only `ready, verified_released, delivered, collected, closed` are enforced; other illegal transitions are logged), bank-recon lock (`accLockDates`), `canManageInventoryControl` (includes finance) vs `roleMatrix`.
- **Impact.** Direct API calls bypass rules (`PATCH /api/repairs/[id]` role-gated but not step-gated for earlier statuses).
- **Remediation.** Widen `GUARDED_TARGETS` once logs are quiet (as the file says), move role-per-transition checks server-side. **Changes business logic?** Yes (tightens).

### KI-15 — Locking
- **Evidence.** `withAppStateKeyLock` catches errors and "proceeds unlocked"; collection CRUD factories are read-modify-write; `lockKey` is opt-in.
- **Impact.** Lost updates under load or DB hiccups. **Remediation.** Fail closed for financial/stock keys; migrate to row-level writes. **Changes business logic?** No.

### KI-16 — Bank reconciliation architecture
- **Evidence.** UI uses `deed_bankRecons`/`deed_bankStatementLines` (store); `/api/accounting/bank-statements*` and `/api/bank-recon/*` have no UI caller; reconciled-period lock only in `saveBankRecon`/`updateBankRecon` (client).
- **Impact.** Reconciliation state is editable via the store endpoint by anyone holding the key ACL (DIR/FIN) and is not tied to journals; adjustments (bank charges/interest) cannot be posted from the UI. **Remediation.** Migrate UI to the Prisma statement model, enforce lock server-side. **Changes business logic?** Yes.

### KI-17 — Settings mass assignment
- **Evidence.** `app/api/settings/route.ts` `POST`: `prisma.companySetting.update({data: {...body, updatedById}})`. Gate DIR/FIN. **Impact.** Arbitrary column writes (e.g. `id`, audit fields). **Remediation.** zod whitelist. **Changes business logic?** No.

### KI-18 — M-Pesa
- **Evidence.** `/api/mpesa/callback` is public (middleware `PUBLIC_API_PATHS`) with no signature/IP check — matched only by `CheckoutRequestID`; `applyStkCallback` marks the request status but creates no `Payment`; `POST /api/mpesa/stk-push` and `stk-query` accept any session.
- **Impact.** Forged callbacks can flip an STK record to `success` if the checkout id is known; any role can trigger customer prompts; the receipt→payment step is manual (`InvoiceDetail` registers payment with the M-Pesa receipt). **Remediation.** Allow-list Safaricom IPs/shared secret in the callback URL, role-gate push, auto-create the payment idempotently from a verified callback. **Changes business logic?** Yes.

### KI-19 — CSRF and CSP
- **Evidence.** `assertSameOriginBrowserWrite` allows requests with no `Origin`; cookie `sameSite=lax`; `next.config.js` CSP `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`. **Impact.** Reduced defence in depth against XSS-assisted CSRF. **Remediation.** CSRF token or require `Origin`/`Sec-Fetch-Site: same-origin` on cookie-authenticated writes; nonce-based CSP. **Changes business logic?** No.

### KI-20 — MFA
- **Evidence.** `requiresPrivilegedMfa` = `MFA_ENFORCE_PRIVILEGED === 'true'` and role in DIR/ADM/FIN; deploy verification requires it (`verify-production-config.mjs`); production value *not verifiable*. **Remediation.** Make enforcement default-on in production. **Changes business logic?** No.

### KI-21 — Rate limiting backend
- **Evidence.** `lib/rate-limit.ts`: Upstash if `UPSTASH_REDIS_REST_*`, else in-memory `Map`; PM2 runs 2 workers. **Impact.** Effective limits double and reset on restart without Upstash. **Remediation.** Use `REDIS_URL` for limits too. **Changes business logic?** No.

### KI-22 — Stray and dead repository files
- **Evidence.** `components/modules/route.ts` (an unrouted handler containing a hard-coded default password and a director password-reset implementation — inert because it is outside `app/`, but a dangerous artefact), `components/modules/middleware.ts` (placeholder "TODO: Replace with actual session verification"), `components/modules/page.tsx` (an unrouted copy of the force-password-change screen), `components/modules/schema.prisma` (593-line stale 30-model schema copy), `lib/route.ts` (duplicate NextAuth config), empty `prisma/layout.tsx`/`prisma/page.tsx`/`lib/page.tsx`, `final_pos_updates.tar.gz`, `pos_updates.tar.gz`, `settings_updates.tar.gz` (contain an older `app/api/pos/charge/route.ts` etc.), `dev_server.log` (676 KB, Next 14.2.3 log), `ops/deploy-trigger-20260901.txt`. **Remediation.** Delete; add `.gitignore` entries. **Changes business logic?** No.

### KI-23 — Migration process
- **Evidence.** No Prisma Migrate history; CI uses `prisma db push --accept-data-loss`; production SQL applied in the *post*-deploy step list in `.github/workflows/deploy.yml`; two numbering schemes (`prisma/migrations`, `database/migrations`); runtime DDL in app code. **Impact.** Schema drift between `schema.prisma`, SQL files and runtime-created tables (`users` columns); ordering risk. **Remediation.** Adopt Prisma Migrate (baseline from production) or a single SQL migration runner with a ledger table; run before deploy. **Changes business logic?** No.

### KI-24 — Dependency/build reproducibility
- **Evidence.** `npm ci` → `ERESOLVE` (`next-auth@4.24.15` peer vs `nodemailer@9`); `package-lock.json` and `pnpm-lock.yaml` both committed; `xlsx` from `cdn.sheetjs.com`; `AGENTS.md` instructs `npm ci`; CI audit ignores two advisories. **Remediation.** Remove the stale lockfile, document pnpm, vendor or mirror `xlsx`, review ignored advisories. **Changes business logic?** No.

### KI-25 — Schema models with no ORM usage
`LeavePolicy, TaxRate, DocumentTemplate, Integration, AttendanceRecord, EmployeeLoan, Supplier, Brand, LabelPrintJob, StockAdjustment, StockAdjustmentItem, SupplierPayment, QuoteItem, PosSession, PosTransactionItem, PosPayment, KilimallSyncLog, AnalyticBudgetLine, PriceListItem, ReconfigurationAttachment, ExpenseRecord, AccountingOutbox, NotificationEscalation, ReportSnapshot, UserSession` (static search for `prisma.<model>.` etc.; several are touched by raw SQL or scripts — see the data model). **Impact.** False impression of capability (e.g. `ExpenseRecord`, `PosSession`). **Remediation.** Wire or drop. **Changes business logic?** No.

### KI-26 — Dead / disconnected endpoints
- **Evidence.** 49 route files have no in-repo caller (list in the API reference), notably `bank-statements*`, `bank-recon/*`, `fiscal-periods*`, `fiscal-lock`, `fixed-assets*`, `payments/[id]/allocations`, `serials/bulk`, `contacts/merge`, `reconfiguration/[id]/calculate-*`. `POST /api/pos/charge` writes `sessionId:'default-session'` into a UUID FK column and cannot succeed. Several of these are legitimate operator/cron/webhook endpoints. **Remediation.** Triage each: connect, document as operator-only, or remove. **Changes business logic?** No.

### KI-27 — Integrity suite gaps
- **Evidence.** `lib/accounting/integrity-suite.ts`: `grni_vs_gl` compares the same TB value to itself; `journal_parity_posted` is `passed: true`; names cite 3102/3110/1805/3005 (superseded codes). **Impact.** Month-end certification overstates assurance. **Remediation.** Compare GRNI to uninvoiced GRN value; implement parity check; fix labels. **Changes business logic?** Yes.

### KI-28 — Costing and account-mapping heuristics
- **Evidence.** `applyOutboundValuation` auto-creates a FIFO layer at *standard cost* (possibly 0) for legacy shortfalls; per-product costing method (`fifo`/`standard`/average) resolved at runtime; `cashAccountRoleForBankId` maps any bank id containing `im` and the default to ABSA (2201); interest income uses 5201 "Dividends and Interest"; `revenue_products` label is bare `5000`. **Impact.** COGS/valuation inaccuracies; mis-mapped bank GL. **Remediation.** Explicit bank-account → GL mapping (the `BankAccount.glAccountId` exists and is used by the payment route but not by the role map); block outbound at zero cost or flag. **Changes business logic?** Yes.

### KI-29 — E-commerce and Kilimall
- **Evidence.** `components/modules/Ecommerce.tsx` (`onlineOrders = []`, settings in component state); Kilimall module is a manual workbench over `deed_kilimall*` keys; the `Kilimall*` Prisma models have no operational reader/writer (only reset/merge utilities touch them); no HTTP client for Kilimall exists. **Remediation.** Label as manual or build integration. **Changes business logic?** No.

### KI-31 — Backups and monitoring
- **Evidence.** `scripts/backup-db.sh` is invoked by the deploy script; no schedule, retention or off-site copy in repo (`scripts/ops/srv-003-backup-offsite.sh.example`, `remediation/IMPLEMENTATION_STATUS.md` "needs credentials"); no external monitoring. SSH hardening script requires console access and human confirmation. **Impact.** Recovery point may be days old between deploys. **Remediation.** Timer + retention + encrypted off-site + restore drill + uptime/alerting. **Changes business logic?** No. *(Server state unverifiable.)*

### KI-32 — Test coverage
- **Evidence.** 383 Vitest files; only **82 of 270** route files are directly imported or referenced by a test (heuristic); `lib/store.tsx` (21 848 lines, the main business-logic container) is excluded from coverage in `vitest.config.ts`; E2E has 30 cases (5 business journeys + smoke + adversarial security). See main document §19. **Remediation.** Prioritise the traceability gaps listed there. **Changes business logic?** No.

### KI-33 — Journal blob still written by the client
- **Evidence.** `lib/accounting/source-of-truth.ts` (`storeStillWritesJournalBlob()` true unless `ACCOUNTING_PRISMA_JOURNAL_WRITERS` is enabled; env not in production template); the client builds journals (`buildInvoicePaymentJournal`, POS journal) and mirrors them; retirement gated by `journal-retire-readiness.ts`. **Impact.** Two journal representations; duplicate risk is managed by ref idempotency. **Remediation.** Complete writers' migration, then retire the blob. **Changes business logic?** No.

### KI-35 — Public portal endpoints
- **Evidence.** `/api/portal/*`, `/portal/*`, `/track/*` are public; repair refs are random (`REP-XXXXXXXX`) but legacy sequential refs remain valid; downloads and approvals require the customer phone on file (setting `secPortalRequirePhoneVerification`, default ON) and are rate-limited. `POST /api/portal/intake` creates repairs without authentication. **Impact.** Enumeration/abuse risk on legacy refs; spam intake. **Remediation.** CAPTCHA/throttle intake, retire sequential refs from public URLs. **Changes business logic?** No.

### KI-37 — Payment SoD check swallows errors
- **Evidence.** `app/api/invoices/[id]/payments/route.ts`: gate + SoD evaluation sit in a `try { … } catch { }` block (reads `deed_invoices` and settings through `loadAppState`). **Impact.** An error in the lookup skips the check. **Remediation.** Fail closed. **Changes business logic?** No.

### KI-38 — Payment identifiers and voids
- **Evidence.** Legacy path `PAY/<uuid8>`; `Payment` has no human number; `RCT` counter declared in `lib/doc-ref-counter.ts` but never allocated; `isVoided` columns unused for writes. **Remediation.** Add `paymentNumber` unique + void workflow with reversal. **Changes business logic?** Yes.

### KI-39 — Credit-note revenue reversal account
- **Evidence.** `lib/accounting/credit-note-service.ts` debits the literal `'5000 - Sales Revenue'` for the subtotal, while invoices credit revenue per line account (product → category → 5000; repair services 5121) in `lib/accounting/invoice-journals.ts`. Capitalised fixed assets credit the literal `3000 - Accounts Payable` (`lib/accounting/fixed-asset-service.ts`).
- **Impact.** Revenue-by-account reporting is distorted by credit notes against products/categories mapped to other accounts; asset purchases settle AP without a bill.
- **Remediation.** Reverse the original invoice-line accounts (use `originalInvoiceItemId`); require a source document for asset capitalisation. **Changes business logic?** Yes.

### KI-40 — Defined but unenforced permissions
- **Evidence.** Static search of `app/`, `lib/`, `components/`, `hooks/`: `approvePayroll, manageInventoryApprovals, printInventoryLabels, viewVendorInventoryLedger, viewPurchaseCost, createCustomerInvoiceFromSO, reverseReconfiguration, viewReconfigSellingPrices, viewReconfigAccounting` appear only in the `roleMatrix` definition. A further 22 permissions are referenced only inside `lib/auth/authorization.ts` to build the store-key ACL maps. `reverse` exists in the reconfiguration state machine but **no `/api/reconfiguration/[id]/reverse` route exists**.
- **Impact.** The permission model overstates the controls in force (e.g. purchase-cost visibility, reconfiguration selling-price/accounting visibility); completed reconfigurations cannot be reversed through the application.
- **Remediation.** Enforce or delete each permission; add the reversal route with `reverseReconfiguration`. **Changes business logic?** Yes.

## Low severity

### KI-30 — Documentation drift
`README.md` (Next.js 14, Odoo-style modules that do not exist, Vercel/`vercel.json`), `docs/DATA_SAFETY_MIGRATION.md` (default backend), `role_access_design.md` ("legacy five-role" and an implementation plan, now implemented), `repair_workflow_implementation_notes.md` (plan text), `remediation/IMPLEMENTATION_STATUS.md` (2026-08-06 branch status), `AGENTS.md` (`npm ci`). Code is authoritative. **Remediation.** Replace with this documentation set; archive plans. **Changes business logic?** No.

### KI-34 — Role definitions duplicated
Three alias tables (`normalizePermissionRole`, `normalizeClientRole`, store-policy `normalizedRole`), TypeScript union (8 roles), Prisma `UserRole` enum (17 values incl. `release_authoriser`). **Remediation.** One shared module generated into all consumers. **Changes business logic?** No.

### KI-36 — Placeholder users and bypass
`lib/auth/public-users.ts` contains seeded Director/other placeholder users used by the layout only when `VISREG_BYPASS_AUTH=true` and `NODE_ENV !== 'production'`; `middleware.ts` refuses the bypass in production. Keep out of production bundles. **Changes business logic?** No.

## Technical-debt themes (not individually numbered)

- `lib/store.tsx` at 21 848 lines mixes UI state, business rules, numbering, journal building and network sync; changes there are the highest-risk edits in the system.
- Hard-coded business constants: default bank-account templates and company settings in `lib/store.tsx` (`DEFAULT_BANK_ACCOUNTS`, `DEFAULT_COMPANY_SETTINGS`), category account defaults (`lib/product-accounts.ts`), policy values such as the KES 1 000 diagnosis fee and effective date (`lib/diagnosis-fee.ts`), tax rate 16 %, admin-officer invoice limit default.
- Placeholder/demo data: `/sales-prototype/**` pages (public, demo data), seed arrays (now empty), `data/catalog-photos` fixtures.
- Pagination: blob-backed collections paginate in memory; `GET /api/store` returns whole collections; the 2026-09-21 incident (paginated 200-row pages saved over whole collections) is why the bulk-delete guard exists.
- Duplicate implementations: three PDF builders (shared template + older `invoice-pdf.ts`, `pdf-quote.ts`, `pdf.ts`), two quotation models, two bank-reconciliation models, two company-settings stores, two payment write paths, three audit trails, two deploy scripts, two lockfiles.
