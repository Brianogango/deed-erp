# Deed ERP — Module Inventory

| | |
|---|---|
| **Document** | ERP Module Inventory (supporting document to [`DEED_ERP_SYSTEM_DOCUMENTATION.md`](./DEED_ERP_SYSTEM_DOCUMENTATION.md)) |
| **Repository / branch / commit reviewed** | `brianogango/deed-erp` · `claude/focused-einstein-lqo6u8` · `1713b7bf39c24703b8f5ab986104868d9de89b87` |
| **Review date** | 2026-10-01 |

## 0. Classification vocabulary and evidence standard

| Label | Meaning in this document |
|---|---|
| **Implemented (traced)** | The UI handler → API/store action → persistence → (where relevant) journal path was traced in source and unit tests exist for at least part of it. *The application was not run and the test suite was not executed in this review* (dependency install blocked — see main document §19), so "traced" means "read and followed", not "observed working". |
| **Implemented, incomplete** | Works for the main path but a documented step is missing, best-effort, or client-only. |
| **Legacy** | Older implementation retained for compatibility; new code should not extend it. |
| **Fallback-only** | Code path that runs only when the primary path is unavailable. |
| **UI-only** | Screen exists; no backend persistence/integration. |
| **Backend-only** | API exists; no in-repo UI caller found. |
| **Broken / disconnected** | Code cannot work as written or is not wired to anything. |
| **Planned / referenced, not implemented** | Mentioned in docs, names or comments but no implementation. |
| **Unable to verify** | Depends on production configuration or external systems not present in the repository. |

"Screens" are the tab ids found in each module component; "Routes" are Next.js page routes (`app/(app)/**/page.tsx`); APIs are summarised here and listed exhaustively in [`ERP_API_REFERENCE.md`](./ERP_API_REFERENCE.md). Store actions (`lib/store.tsx`) are the client-side orchestration layer — where a business rule lives only there it is called out as **client-side**.

## 1. Technology and structure at a glance

| Item | Finding | Evidence |
|---|---|---|
| Frontend | Next.js **15.5.24** App Router, React 18, TypeScript, Tailwind CSS, FontAwesome/Lucide icons, `html5-qrcode`, `jspdf`/`jspdf-autotable`, `xlsx` (loaded from `cdn.sheetjs.com`) | `package.json` |
| Backend | Next.js route handlers (`app/api/**`, Node runtime) calling Prisma 7 (driver adapter `pg`), raw `pg` SQL for auth/store/counters | `lib/prisma.ts`, `lib/auth/db.ts` |
| Database | PostgreSQL (CI uses `postgres:16`) | `.github/workflows/deploy.yml` |
| Auth | Credentials login → signed JWT cookie `deed-session` (12 h, 24 h absolute), bcrypt (cost 12) with legacy SHA-256 upgrade, 5-attempt/15-min lockout, optional TOTP MFA for DIR/ADM/FIN, trusted-browser tokens | `app/api/auth/login/route.ts`, `lib/auth/*` |
| State management | One giant client context (`lib/store.tsx`, **21 848 lines**) built on `useLS` (localStorage + debounced server sync + SSE/polling merge); HR domain in a Zustand store (`hooks/useHrStore.ts`); Prisma-backed REST hooks for CRM/leave/payroll/notifications | `lib/store.tsx`, `hooks/` |
| Storage | PostgreSQL (`app_state`, Prisma tables); object store (local disk or S3-compatible) for binaries (`blobs`, `.uploads`); optional Redis | `lib/infra/object-store.ts` |
| Production | Contabo VPS, Nginx → PM2 cluster (2 workers, port 3000) → Next.js; PostgreSQL on localhost; deploy via GitHub Actions SSH to `/usr/local/bin/deed-erp-deploy.sh` | `ecosystem.config.js`, `ops/nginx-deed-erp.conf.example`, `.github/workflows/deploy.yml` |
| Tests | Vitest (383 `*.test.ts(x)` files under `__tests__/`), Playwright (3 specs, 30 test cases) | `vitest.config.ts`, `playwright.config.ts`, `e2e/` |

## 2. Page routes (screens reachable by URL)

Authenticated shell (`app/(app)/layout.tsx`, session required):

| Route | Component | Module id (sidebar gate) |
|---|---|---|
| `/` | `Dashboard` (+`SalesDashboard`, `RepPerformance`) | `dashboard` |
| `/sales` | `Sales` | `sales` |
| `/crm` | `CRM` | `crm` |
| `/pos` | `POS` | `pos` |
| `/ecommerce` | `Ecommerce` | `ecommerce` |
| `/kilimall` | `Kilimall` | `kilimall` |
| `/contacts` | `Contacts` | `contacts` |
| `/inventory`, `/inventory/serial/[id]` | `Inventory` | `inventory` |
| `/purchases` | `Purchase` | `purchase` |
| `/delivery` | `Delivery` | `delivery` |
| `/repairs` | `Repair` (+`RepairClientJobs`, `RepairRefurbJobs`, `RepairModals`) | `repair` |
| `/refurbishment` | `Refurbishment` | `refurbishment` |
| `/reconfiguration` | `Reconfiguration` | `reconfiguration` |
| `/outsource` | `Outsource` | `outsource` |
| `/aftersales` | `AfterSales` (+`TradeIn`) | `after_sales` |
| `/holdovers` | `Holdovers` | `holdovers` |
| `/property` | `CompanyProperty` | `company_property` |
| `/finance`, `/finance/invoices/[id]` | `Accounting`, `InvoiceDetail` | `accounting` |
| `/cashbook` | `CashbookPage` | `accounting` |
| `/deposits` | `Deposits` | `deposits` |
| `/expenses` | `Expenses` | `expenses` (self-service) |
| `/hr` | `HR`, `HRSettings` | `hr` (self-service view; management by role) |
| `/documents` | `MyDocuments` | `my_documents` |
| `/sops` | `SOPs` (KPI Targets) | `sops` |
| `/sop-documents` | `SOPDocuments` | `sop_documents` |
| `/settings` | `Settings` (+ `components/modules/settings/*`) | director only (sidebar) |
| `/account/password-change` | `PasswordChangeScreen` | any |
| `/operations` | — | redirects to `/inventory` (`LEGACY_ROUTE_REDIRECTS`); `app/(app)/operations/page.tsx` still exists |

Public/other routes: `/login`; `/track`, `/track/[...ref]` (public repair tracking); `/portal/repair/[ref]`, `/portal/repair/[...ref]`, `/portal/repair/new` (customer intake), `/portal/quotes/[id]`; `/sales-prototype/**` (static look-alike pages with demo data — **not production routes**; `AGENTS.md` says to test `/sales`, not `/sales-prototype`, and middleware lists `/sales-prototype` as public).

Legacy redirects (`middleware.ts`): `/dashboard→/`, `/purchase→/purchases`, `/operations→/inventory`, `/accounting→/finance`, `/after_sales→/aftersales`, `/hr/documents→/documents`.

## 3. Module catalogue summary (the mandated checklist)

Each row states whether the module exists, how it is implemented and its status. Detail per module (purpose, users, rules, statuses, accounting, limitations, references) is in main document §6, which links back here.

| # | Module (requested) | Present? | Classification | Where it lives (UI) | Backend / persistence | Notes |
|---|---|---|---|---|---|---|
| 1 | Dashboard | Yes | Implemented (traced) | `/` `Dashboard.tsx` | Reads store keys (`appStateKeysForRoute('/')`); `/api/accounting/dashboard` for finance | KPI numbers computed client-side from store arrays |
| 2 | Contacts | Yes | Implemented (traced) | `/contacts` tabs `all, customers, vendors, companies, individuals, persons, chatter, financial, history, info` | `/api/contacts*`, `/api/companies`, `/api/contact-persons`; `Client`, `ContactPerson` | REST-SoT; archive/restore/merge (DIR) |
| 3 | Customers | Yes (a filter on Contacts) | Implemented (traced) | Contacts → `customers` | `Client.isCustomer` | credit limit, payment terms, loyalty points, customer credit |
| 4 | Vendors | Yes (a filter on Contacts) | Implemented (traced) | Contacts → `vendors` | `Client.isVendor`; legacy `Supplier` model unused | |
| 5 | Sales | Yes | Implemented (traced) | `/sales` tabs `quotations, orders, crm, after_sales` | `/api/sale-orders*`, `/api/quotes*`; `SaleOrder`, `Quote` | Odoo-style state machine in `lib/odoo-sales-flow.ts` |
| 6 | Quotations | Yes — **two kinds** | Implemented, incomplete (dual model) | Sales → `quotations`; CRM quotes | CRM `Quote` (REST) and quotation-state `SaleOrder` | Both use prefix `QUO` and share one counter |
| 7 | Sales orders | Yes | Implemented (traced) | Sales → `orders` | `SaleOrder` (+`lockVersion`, versions) | confirm/cancel/reset are client actions + server transition validation |
| 8 | Customer invoices | Yes | Implemented (traced), GL posting best-effort | `/finance` tab `invoices`; `/finance/invoices/[id]` | `/api/invoices*`; `Invoice`, `InvoiceItem`, `TaxTransaction` | see KI-02 |
| 9 | Payments and collections | Yes | Implemented (traced) | Finance `invoices`/`bills`, `InvoiceDetail` | `/api/invoices/[id]/payments`, `/api/payments`, `/api/mpesa/*`; `Payment`, `PaymentAllocation`, `MpesaStkRequest` | M-Pesa callback updates status only |
| 10 | Purchase | Yes | Implemented (traced) | `/purchases` tabs `orders, receipts` | `/api/purchase-orders*`, `/api/inventory/validate-receipt` | |
| 11 | Requests for quotation | Yes — as a **draft PO sent to a vendor** | Implemented, incomplete | `POFormView.tsx` "Send RFQ" | `POST /api/integrations/send-rfq`; PO status `draft → sent` | No separate RFQ entity or vendor-quote comparison |
| 12 | Purchase orders | Yes | Implemented (traced) | Purchases → `orders` | `PurchaseOrder`, `PurchaseOrderItem` | statuses `draft, sent, confirmed, partial, received, cancelled` |
| 13 | Vendor bills | Yes | Implemented (traced), payment journal defect | Finance → `bills`; PO "Create Bill" | `Invoice` rows `documentType='vendor_bill'` | 3-way match; see KI-03 |
| 14 | Expenses | Yes | Implemented, incomplete | `/expenses` tabs `mine, review` | blob `deed_expenses`; `POST /api/expenses/post-journal`; `/api/expense-receipts/*` | `ExpenseRecord` model unused |
| 15 | Point of Sale | Yes | Implemented, incomplete (client-orchestrated) | `/pos` | `/api/pos/record-order`, `/post-sale-journal`, `/api/inventory/apply-pos-stock`; blob `deed_posOrders`/`deed_posSessions` | `/api/pos/charge` is dead |
| 16 | Finance | Yes | Implemented (traced) | `/finance` (many tabs) | `/api/accounting/*` | |
| 17 | Cashbook | Yes | Implemented, incomplete | `/cashbook`, Finance tab `cashbook` | store keys `deed_bankAccounts`, `deed_journalEntries` | client-derived |
| 18 | Bank accounts | Yes | Implemented, incomplete | Finance / Settings | blob `deed_bankAccounts`; `BankAccount` used for payment FK | two models |
| 19 | Bank reconciliation | Yes | Implemented, incomplete; **Prisma API backend-only** | Cashbook tabs `recon, reconcile, matching, statement` | blob `deed_bankRecons`, `deed_bankStatementLines`; `/api/accounting/bank-statements*`, `/api/bank-recon/*` (no UI caller) | lock enforced client-side |
| 20 | General ledger | Yes | Implemented (traced) | Finance `gl` | `/api/accounting/general-ledger` (Prisma) | |
| 21 | Chart of accounts | Yes | Implemented (traced) | Finance `coa` | `AccountCode`; `/api/accounting/bootstrap-coa`; `lib/accounting/coa-template.ts` | official CoA aligned by SQL migrations |
| 22 | Journal entries | Yes | Implemented (traced) | Finance `journals` | `/api/accounting/journals`, `/system-journals` | immutable by app logic only |
| 23 | Trial balance | Yes | Implemented (traced) | Finance `trial_balance` | `/api/accounting/trial-balance` → `buildTrialBalance` | Prisma only |
| 24 | Profit and loss | Yes | Implemented (traced) | Finance `pl` | `/api/accounting/profit-loss` → management P&L | |
| 25 | Balance sheet | Yes | Implemented (traced) | Finance `bs` | `/api/accounting/balance-sheet` | |
| 26 | Cash flow | Yes | Implemented (traced) | Finance `cash_flow` | `/api/accounting/cash-flow` | direct method from cash-account movements |
| 27 | Financial periods & month-end closing | Yes | Implemented, incomplete: **API-only for periods/lock**; UI for integrity/month-end | Finance `monthly`, `integrity` | `/api/accounting/fiscal-periods*`, `/fiscal-lock`, `/month-end`, `/integrity`; `FiscalPeriod`, `FiscalLock`, `FinancialReconciliation` | |
| 28 | Budgets and analytics | Yes | Implemented, incomplete | Finance `analytics` (`AnalyticBudgetsTab`) | `/api/accounting/analytic-accounts`, `/analytic-budgets`, `/budget-vs-actual`; `Analytic*` | `AnalyticBudgetLine` unused |
| 29 | Inventory | Yes | Implemented (traced) | `/inventory` (18 tabs) | `/api/products*`, `/api/serials*`, `/api/inventory/*`; Prisma + blob | |
| 30 | Products | Yes | Implemented (traced) | Inventory `product_master`, `product_catalog` | `Product`, `ProductImage`, `Category` | duplicate-merge tools |
| 31 | Warehouses and locations | Yes — **fixed location enum**, not a warehouse master table | Implemented, incomplete | Inventory `warehouse_view`, `stock_on_hand` | `LocationId` (`warehouse, shop("With Issues"), repair_unit, computer_aid, computer_aid_collected, computer_aid_issues, vendor, customer, employee, pending_testing, quarantine`); serial units carry `location`; bulk quantities per location in `BulkStockLevel` / blob `deed_bulkStock`; `StockLevel` is one row per product (no location) | no Warehouse master model |
| 32 | Stock transfers | Yes | Implemented, incomplete (client-numbered) | Inventory `transfers` | `POST /api/inventory/apply-transfer-stock`; blob `deed_stockTransfers`, `deed_stockMoves` | |
| 33 | Stock receipts | Yes | Implemented (traced) | Purchases → `receipts`; Inventory `stock_in` | `/api/inventory/validate-receipt`; `GoodsReceivedNote`, `StockMovement`, valuation | |
| 34 | Stock issues | Yes | Implemented (traced) | Inventory `stock_out`, `checkouts`, `adjustments` | `/api/inventory/stock-checkouts`, `/apply-adjustment-stock`, `/apply-vendor-return-stock`, `/apply-customer-return-stock` | |
| 35 | Computer Aid custody stock | Yes | Implemented, incomplete | Inventory (custody panel `ComputerAidCustodyPanel`) | `GET/POST /api/inventory/computer-aid`; locations `computer_aid*` | |
| 36 | Refurbishment consumption | Yes | Implemented, incomplete (client store) | `/refurbishment` | store `deed_refurbishmentJobs` (statuses `queued…written_off`); part requests `requestPartFromInventory`/`allocateRefurbPart` | |
| 37 | Repair | Yes | Implemented (traced) | `/repairs` tabs `client, refurb` | `/api/repairs*`; `Repair` | 20 statuses |
| 38 | Diagnosis | Yes | Implemented (traced), client-side rules | Repair detail | `logDiagnosis` store action; `/api/repair-diagnosis-reports/*` | |
| 39 | Parts approval and issue | Yes | Implemented, incomplete | Repair parts panel; Inventory `parts_requests` | `requestProcurement`, `raisePartsPurchaseOrder`, `correctPartsCount`; `POST /api/repairs/[id]/parts-cogs` | COGS Dr 6301 / Cr inventory |
| 40 | Repair quotations | Yes | Implemented (traced) | Repair detail; portal | `generateRepairQuote`, `sendQuoteToCustomer`; `/api/portal/repair/[ref]/quote-pdf` | revision logic in `lib/sales/repair-quote-revision.ts` |
| 41 | Quote acceptance and decline | Yes | Implemented (traced) | Portal `/portal/repair/[ref]`; staff `approveRepairQuote`/`declineQuote` | `POST /api/portal/repair/[ref]/approve` | creates SO/invoice server-side |
| 42 | Technician assignment | Yes | Implemented, client-side rule | Repair detail | `assignTechnicianToRepair` (`isRepairAssignerRole`); `/api/technicians` | |
| 43 | Technical-lead assignment | Yes (the technical lead *is* the assigner; leads can also be assignees) | Implemented, client-side rule | same | same | no separate "lead assignment" workflow beyond `technical_lead` role |
| 44 | Quality control | Yes | Implemented (traced) | Repair QC checklist | `addRepairQAItem`, `completeRepairQA`; `/api/repair-qc-reports/*` | server guards arrival at `ready` |
| 45 | Warranty checking | Yes | Implemented (traced) | Repair intake; After-Sales `warranties` | `checkWarrantyForRepair`, `lib/repair-warranty.ts`; blob `deed_warranties` | |
| 46 | Repair completion and collection | Yes | Implemented (traced) | Repair `ready`→`verified_released`→`collected` | `markRepairReady`, `deliverRepair`, `closeRepairJob`; ORC gate `/api/outbound-releases*` | |
| 47 | Delivery | Yes | Implemented (traced); stock/valuation in blob path | `/delivery` tabs `jobs, riders, weekly_pay` | `/api/deliveries*`; `DeliveryNote` mirror; blob `deed_deliveryJobs`, `deed_riders`, `deed_riderWeeklyPays` | |
| 48 | Reconfiguration | Yes | Implemented (traced) | `/reconfiguration` | `/api/reconfiguration/*`; `Reconfiguration*` | Prisma-native, state machine in `lib/reconfiguration/state-machine.ts` |
| 49 | Outsource | Yes | Implemented, incomplete (client store) | `/outsource` tabs `jobs, vendors` | blob `deed_outsourceJobs/Vendors/Payments` | statuses `sent, returned_resolved, returned_unresolved` |
| 50 | Aftersales | Yes | Implemented, incomplete | `/aftersales` tabs `returns, trade, warranties` | blob `deed_returnOrders`, `deed_buyBacks`, `deed_donations`, `deed_clientExchanges`, `deed_refundPayments`; `/api/inventory/apply-customer-return-stock` | RMA statuses `requested…rejected` |
| 51 | Holdover | Yes | Implemented (traced) | `/holdovers` | `Holdover` via REST/mirror | statuses `active, returned, overdue` |
| 52 | Deposits | Yes | Implemented (traced) | `/deposits` | `/api/deposits*`; `Deposit*` | journals via `deposit-service` |
| 53 | Asset management | Yes | Implemented, incomplete | `/property` | blob `deed_companyAssets`; `/api/accounting/fixed-assets*` (no UI caller); `FixedAsset` | depreciation via store action `runCompanyAssetDepreciation` + `ppe-journals` |
| 54 | HR | Yes | Implemented (traced) | `/hr` tabs `employees, leave, payroll, salary_advances, recruitment, training, performance, documents, assets, reports, self_service` | `/api/employees`, `/api/leave-requests*`, `/api/payroll*`, `/api/salary-advances*`; Prisma | Kenya statutory payroll (`lib/hr/kenya-payroll.ts`) |
| 55 | KPI targets | Yes | Implemented, incomplete | `/sops` tabs `overview, manage, my` | blob `deed_sops`, `deed_sopActuals`, `deed_hr_perf_targets` | |
| 56 | Kilimall | Yes | **UI/store-only — no marketplace integration** | `/kilimall` tabs `orders, dispatch, returns, settlements, reconciliation, financial, control, ops, reports, settings` | blob `deed_kilimallOrders/Dispatches/Settlements`; `Kilimall*` models have no operational reader/writer; `img.kilimall.com` image allow-list only | orders are entered/imported manually |
| 57 | Reports | Yes (embedded per module) | Implemented (traced) | Finance `reports`, `financial_report`, `ageing`, `vat`, `commissions`; Inventory `reports`, `valuation`; HR `reports`; Kilimall `reports` | `/api/accounting/*`, `/api/inventory/valuation-report` | no standalone Reports module |
| 58 | PDF and printing templates | Yes | Implemented (traced) | Settings → document layout; PDF buttons | `lib/deed-document-pdf.ts` (jsPDF), `commercial-pdf.ts`, `delivery-note-pdf.ts`, `purchase-pdf.ts` | 7 layouts × 7 fonts |
| 59 | Settings | Yes | Implemented (traced) | `/settings` | `/api/settings*`; blobs `deed_companySettings`, `deed_systemSettings` | director-only navigation |
| 60 | Audit logs | Yes | Implemented, incomplete | Settings / `/api/admin/audit` | `AuditLog`, `FinancialAuditEvent`, `deed_audit_timeline_v1`, `store_audit_archive` | three trails |
| 61 | Notifications | Yes | Implemented (traced) | bell / Settings panels | `/api/notifications*`, `/api/webhooks/notifications/*`, worker `lib/notifications/worker.ts`; `Notification*` | channels: in-app, web-push, e-mail, SMS, WhatsApp |
| 62 | User and permission management | Yes | Implemented (traced) | Settings → users | `/api/users*`, `/api/admin/users/[id]/mfa`, `/api/admin/security/*` | |

### 3.1 Additional modules and capabilities found (not in the requested list)

| Module | Classification | Where | Notes |
|---|---|---|---|
| E-commerce (`/ecommerce`) | **UI-only** | `Ecommerce.tsx` (220 lines) | `onlineOrders` is a constant empty array; settings are component state, never persisted |
| Device reconfiguration | Implemented (traced) | `/reconfiguration`, 17 API routes | upgrade/downgrade of serialised machines with approvals, QA, stock reservation and costing |
| Outbound release control (ORC) | Implemented, incomplete | `OutboundReleasePanel`, `/api/outbound-releases*` | pick → verify → release gate for repairs/invoices/deliveries; bare `PATCH /[id]` is unsafe (KI-05) |
| Customer portal & tracking | Implemented (traced) | `/portal/*`, `/track/*`, `/api/portal/*` | repair status, quote approval, payment proof, PDFs, messages |
| Partner (reseller) API | Implemented (traced) | `/api/public/v1/products*`, `/api/partner-keys*` | read-only catalogue + images, key admin in Settings |
| Sales inbox → CRM leads | Implemented, config-dependent | `lib/crm/*`, `/api/cron/sales-inbox-*`, `/api/crm/email-review`, `/api/leads*` | IMAP polling (`imapflow`), Gemini-assisted relevance (`SALES_INBOX_GEMINI_MODEL`) |
| DIA / Jarvis AI assistant | Implemented, config-dependent | `components/jarvis`, `/api/jarvis/*`, `lib/jarvis/*` (16 tools under `lib/jarvis/tools/`) | providers Gemini/Anthropic; `jarvis` module grant; write tools gated (`__tests__/jarvis-write-tools.test.ts`) |
| Trade-in / buy-back / donations / exchanges | Implemented, incomplete | After-Sales | blob keys; store actions `createBuyBack…stockBuyBack`, `createDonation`, `createExchange…` |
| Delivery jobs, riders, weekly pay | Implemented, incomplete | Delivery | blob keys; `generateWeeklyPay`, `markWeeklyPayPaid` |
| Sales commissions | Implemented (traced) | Finance `commissions`; `/api/sales-commissions` | `SalesCommission`, `lib/accounting/sales-commission.ts` |
| Currency, price lists, FX revaluation | Implemented, incomplete | Settings `CurrencyPricelistCutover`; `/api/settings/exchange-rates`, `/pricelists`; `/api/accounting/fx-revaluation` | functional currency fixed to KES |
| Approval rules / sales approvals | Implemented (traced) | Settings `ApprovalRulesEditor`; `/api/settings/approval-rules` | margin/discount/credit approvals (`lib/sales-approval-*.ts`) |
| Label printing | Implemented (traced) | Inventory (serial/product labels) | `lib/inventory/label-pdf.ts`, thermal templates |
| Consignment devices | Implemented, incomplete | `/api/inventory/consignments*` | `ConsignmentDevice` |
| Customer credits & refunds | Implemented (traced) | Finance `credits`, `refunds` | store keys + `credit-note-service`, `/api/sale-orders/[id]/credit-note` |
| Document chatter / messaging | Implemented, incomplete | Contacts `chatter`; `/api/chatter` | `DocumentMessage`, `DocumentActivity` |
| Notifications SMS conversations | Implemented, config-dependent | Settings `SmsMessageCenter`; `/api/admin/sms/messages` | Telerivet / Twilio |
| Infra platform (jobs, snapshots, cache) | Implemented, config-dependent | `lib/infra/*`, `/api/cron/infra` | `BackgroundJob`, `ReportSnapshot`, Redis |
| Visual-regression harness | Dev tooling | `scripts/capture-visual-regression.mjs`, `VISREG_BYPASS_AUTH` | bypass honoured only when `NODE_ENV !== 'production'` |

### 3.2 Items named in documentation or the README that are **not** implemented

`README.md` lists Odoo-style modules that have no corresponding code in this repository: **Subscriptions, Helpdesk, Project, Field Service, Email Marketing, Social Marketing, Events, Discuss (team chat), Calendar (UI), To-do, Sign, Documents file manager, Recruitment kanban (a basic recruitment tab exists in HR), Financing, Trade-in valuations (a trade-in/buy-back flow exists in After-Sales)**. The README also states Next.js 14 and a `vercel.json` build; the code is Next 15.5.24 and no `vercel.json` exists (`netlify.toml` exists and is used for deploy previews only). Treat the README as stale (KI-30).

## 4. Client store action inventory (business logic that lives in `lib/store.tsx`)

The context interface (`AppState`) exposes ~400 actions. Grouped by domain (names as exported):

- **Sales & CRM:** `createQuote, updateQuote, sendQuote, acceptQuote, rejectQuote, convertQuoteToSaleOrder, reviseQuote, createOpportunity, moveOpportunityStage, markOpportunityWon/Lost, logActivity, createCustomerContract…, createSaleOrder, updateSaleOrder, addSOLine, confirmSO, markQuotationSent, resetSOToDraft, cancelSO, createNewSOVersion, createInvoiceFromSO, createInvoiceFromDelivery, checkDiscountApproval, requestApproval, approveRequest`.
- **Delivery:** `prepareDelivery, validateDelivery, reverseDelivery, confirmDeliveryWithStockDeduction, createDeliveryFromSO, scheduleInvoiceDelivery, createDeliveryJob, assignRiderToJob, advanceJobStatus, generateWeeklyPay`.
- **Invoicing/finance:** `createManualInvoice, updateInvoice, postInvoice, registerPayment, resetInvoiceToDraft, cancelInvoice, deleteInvoice, applyCustomerCreditToInvoice, issueCreditNoteFromSaleOrder, saveBankRecon, matchStatementLine, autoMatchStatements, submitExpense, reviewExpense, payExpense, reimburseExpense, createDeposit, completeDeposit, createPayrollRun, approvePayrollRun, postPayrollRun, payPayrollRun, applySalaryAdvance…`.
- **Purchasing:** `createPO, sendPO, confirmPO, revertPOToDraft, createReceiptFromPO, validateReceipt, createBillFromPO, createPurchaseReturn, confirmPurchaseReturn`.
- **Inventory:** `addProduct, updateProduct, intakeProductSerials, updateSerial, importOpeningStock, createTransfer, validateTransfer, submitTransfer, createAdjustment, approveAdjustment, reserveStock, fulfillReservation, cancelReservation, initRelease, pickRelease, verifyReleaseItem, completeRelease, voidRelease`.
- **Repair:** `createRepair, verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, markDiagnosisFeePaid, waiveDiagnosisFee, markRepairNoCharge, generateRepairQuote, sendQuoteToCustomer, approveRepairQuote, declineQuote, startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived, markRepairReady, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair, consolidateRepairInvoices, reviewPortalPayment, requestProcurement, raisePartsPurchaseOrder, markUnrepairable, returnToCustomer, leaveDeviceWithDeed, convertRetainedRepairToDonation/BuyBack, createTradeInFromRepair, checkWarrantyForRepair, fileWarrantyClaim`.
- **POS:** `openPOSSession, closePOSSession, createPOSOrder`.
- **After-sales:** `createReturnOrder, approveReturn, receiveReturn, processReturn, createBuyBack…, createDonation…, createExchange…`.
- **Refurbishment/outsource/kilimall/HR/assets:** `createRefurbishmentJob…transferToSell, addOutsourceJob, returnOutsourceJob, recordOutsourcePayment, createKilimallOrder…reconcileKilimallSettlement, assignAssetToEmployee…, createCompanyAsset…runCompanyAssetDepreciation`.

Because these actions run in the browser, a rule that appears only here (see the "client-side" tags above and main document §12/§20) can be bypassed by calling the underlying REST endpoint directly unless the endpoint repeats the rule.
