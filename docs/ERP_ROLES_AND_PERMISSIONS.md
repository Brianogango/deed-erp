# Deed ERP — Roles and Permissions

| | |
|---|---|
| **Document** | ERP Roles and Permissions (supporting document to [`DEED_ERP_SYSTEM_DOCUMENTATION.md`](./DEED_ERP_SYSTEM_DOCUMENTATION.md)) |
| **Repository / branch / commit reviewed** | `brianogango/deed-erp` · `claude/focused-einstein-lqo6u8` · `1713b7bf39c24703b8f5ab986104868d9de89b87` |
| **Review date** | 2026-10-01 |
| **Primary sources** | `lib/auth/types.ts`, `lib/auth/authorization.ts`, `lib/auth/access.ts`, `lib/auth/store-write-policy.ts`, `middleware.ts`, route handlers (`requireRole`/`requirePermission`), client helpers in `lib/store.tsx` |

## 1. The authorisation model in one page

Authorisation in this system is **layered and not unified**. Four independent mechanisms exist; a request can be allowed or denied by any of them, and they do not always agree:

| # | Mechanism | Where | Granularity | Enforced on |
|---|---|---|---|---|
| 1 | **Role** (one of 8) stored on the user and copied into the JWT | `lib/auth/types.ts` `USER_ROLES` | coarse | server (all) + client |
| 2 | **Module grants** (`user.modules[]`, 26 module ids) | `lib/auth/types.ts` `MODULE_IDS`, `ROLE_DEFAULT_MODULES`; edited in Settings | menu / feature | **client** (sidebar, `hasModuleAccess`); **server** only in a few places (`canWriteStoreKey` module check, repair routes, Jarvis) |
| 3 | **Named permissions** (`roleMatrix`, 50 actions) | `lib/auth/authorization.ts` | action | server (`requirePermission`, `hasPermission`) and some client helpers |
| 4 | **Per-route inline role arrays** (`requireRole([...])`, `WRITE_ROLES` constants, `allowedWriteRoles`) | each `app/api/**/route.ts` | endpoint | server |
| 5 | **Wholesale-store ACL** (`STORE_WRITE_POLICIES` role + module, `SENSITIVE_STORE_KEY_*`, `COLLABORATIVE_STORE_READ_POLICIES`, row slicing) | `lib/auth/store-write-policy.ts`, `lib/auth/authorization.ts` | per `deed_*` key / per row | server (`/api/store*`) |
| 6 | **Record-level** (`canAccessRecord`: sale_order, opportunity, repair, expense) | `lib/auth/authorization.ts` | row | server (selected routes) |
| 7 | **Client-side action guards** (`canManageFinance`, `canManageInventoryControl`, per-action role lists in `lib/store.tsx`) | `lib/store.tsx` | action | **client only** unless a server route repeats the rule |

Roles are normalised by alias: `super_admin`, `admin` → `director`; `finance` → `finance_officer`; `inventory` → `inventory_officer`; `kilimall` → `kilimall_officer`; `sales` → `sales_rep`; `lead_tech` → `technical_lead`; `repair_tech` → `technician` (`normalizePermissionRole`, `normalizeClientRole`, `normalizedRole` — three copies of the same alias table).

## 2. Roles

| Role id | Label | Default module grants (`ROLE_DEFAULT_MODULES`) | Intent (from `role_access_design.md` and code comments) |
|---|---|---|---|
| `director` | Director | all 26 | Full access; sole holder of user management, audit log, admin tools, period reopen, force month-end, Settings navigation |
| `admin_officer` | Admin Officer | dashboard, sales, crm, contacts, purchase, inventory, delivery, after_sales, deposits, holdovers, company_property, reconfiguration + self-service | Process/master-data/workflow control, invoicing, purchasing, HR management (`HR_MANAGER_ROLES` = DIR, ADM) |
| `finance_officer` | Finance Officer | dashboard, accounting, sales, crm, contacts, purchase, inventory, kilimall, ecommerce, deposits, company_property, reconfiguration + self-service | Accounting, bank/cash, payments, reports, payroll approval |
| `inventory_officer` | Inventory Officer | dashboard, inventory, delivery, purchase, holdovers, reconfiguration + self-service | Physical stock control, GRN validation |
| `kilimall_officer` | Kilimall Officer | dashboard, kilimall, inventory, delivery, ecommerce, after_sales, reconfiguration + self-service | Marketplace orders/returns; POS roles |
| `sales_rep` | Sales Rep | dashboard, sales, crm, contacts, delivery, after_sales, holdovers, reconfiguration + self-service | CRM, quotations, sales orders (own rows), POS |
| `technical_lead` | Technical Lead | dashboard, repair, refurbishment, reconfiguration, inventory, outsource, after_sales, holdovers + self-service | Repair assignment/QC, refurbishment oversight; repair billing |
| `technician` | Technician | dashboard, repair, reconfiguration + self-service | Assigned repair jobs only |

Self-service modules (`hr`, `sops`, `sop_documents`, `expenses`, `my_documents`, `leave`) are granted to every logged-in user by `hasModuleAccess` regardless of the stored grant (`SELF_SERVICE_MODULES` in `lib/auth/access.ts`). `company_property` is additionally granted to admin_officer and finance_officer by code. `jarvis` (DIA assistant) is granted to the director only by default.

**Schema mismatch:** the Prisma enum `UserRole` contains 17 values, including `release_authoriser` and legacy aliases, but the TypeScript role list has 8 and a code comment (`app/api/outbound-releases/[id]/route.ts`) records that `release_authoriser` "isn't a real UserRole". The authoritative role column is the raw `users.role` text managed by `lib/auth/users-repository.ts`.

### 2.1 Module grants by role (defaults)

| Module ID | DIR | ADM | FIN | INV | KIL | SALES | TL | TECH |
|---|---|---|---|---|---|---|---|---|
| `dashboard` | ● | ● | ● | ● | ● | ● | ● | ● |
| `sales` | ● | ● | ● |  |  | ● |  |  |
| `crm` | ● | ● | ● |  |  | ● |  |  |
| `inventory` | ● | ● | ● | ● | ● |  | ● |  |
| `contacts` | ● | ● | ● |  |  | ● |  |  |
| `purchase` | ● | ● | ● | ● |  |  |  |  |
| `pos` | ● |  |  |  |  |  |  |  |
| `repair` | ● |  |  |  |  |  | ● | ● |
| `refurbishment` | ● |  |  |  |  |  | ● |  |
| `reconfiguration` | ● | ● | ● | ● | ● | ● | ● | ● |
| `delivery` | ● | ● |  | ● | ● | ● |  |  |
| `ecommerce` | ● |  | ● |  | ● |  |  |  |
| `kilimall` | ● |  | ● |  | ● |  |  |  |
| `accounting` | ● |  | ● |  |  |  |  |  |
| `hr` | ● | ● | ● | ● | ● | ● | ● | ● |
| `outsource` | ● |  |  |  |  |  | ● |  |
| `sops` | ● | ● | ● | ● | ● | ● | ● | ● |
| `sop_documents` | ● |  |  |  |  |  |  |  |
| `after_sales` | ● | ● |  |  | ● | ● | ● |  |
| `deposits` | ● | ● | ● |  |  |  |  |  |
| `holdovers` | ● | ● |  | ● |  | ● | ● |  |
| `company_property` | ● | ● | ● |  |  |  |  |  |
| `expenses` | ● | ● | ● | ● | ● | ● | ● | ● |
| `leave` | ● | ● | ● | ● | ● | ● | ● | ● |
| `my_documents` | ● | ● | ● | ● | ● | ● | ● | ● |
| `jarvis` | ● |  |  |  |  |  |  |  |

`settings` is **not** a module id: the Settings screen is visible only when `role === 'director'` (`components/layout/Sidebar.tsx`). `company_property` appears in the sidebar as "Asset Management" (`/property`).

## 3. Named permissions (`roleMatrix`)

● = role holds the permission. Abbreviations: DIR director, ADM admin_officer, FIN finance_officer, INV inventory_officer, KIL kilimall_officer, SALES sales_rep, TL technical_lead, TECH technician.

| Permission (roleMatrix) | DIR | ADM | FIN | INV | KIL | SALES | TL | TECH | Intent (from source comment) |
|---|---|---|---|---|---|---|---|---|---|
| `manageUsers` | ● |  |  |  |  |  |  |  |  |
| `viewUsers` | ● | ● |  |  |  |  |  |  |  |
| `manageHR` | ● | ● |  |  |  |  |  |  |  |
| `approveLeave` | ● | ● | ● |  |  |  | ● |  |  |
| `approvePayroll` | ● |  | ● |  |  |  |  |  |  |
| `viewHrRecords` | ● | ● | ● |  |  |  | ● |  | Read access to HR records (leave, HR documents, employee full profiles). Includes technical_lead so leads can review their technicians' leav |
| `viewEmployeeSensitive` | ● | ● | ● |  |  |  |  |  | Read access to full employee compensation/PII (salary, bank, national ID). |
| `manageInventoryApprovals` | ● |  |  | ● | ● |  | ● |  |  |
| `validatePurchaseReceipt` | ● | ● |  | ● |  |  |  |  | Validate purchase receipts / GRNs — stock-affecting; keep tight. technical_lead intentionally excluded (ops oversight ≠ stock receipt author |
| `editSerialNumber` | ● | ● |  | ● |  |  | ● |  |  |
| `printInventoryLabels` | ● | ● | ● | ● | ● |  | ● |  |  |
| `viewVendorInventoryLedger` | ● | ● | ● | ● |  |  | ● |  |  |
| `viewPurchaseCost` | ● | ● | ● | ● |  |  |  |  |  |
| `createCustomerInvoiceFromSO` | ● | ● | ● |  |  |  |  |  | Draft customer invoice from a confirmed sale order. |
| `postFinancial` | ● | ● | ● |  |  |  |  |  | Post journals + customer invoice payment (Admin Officer threshold enforced in actions/API). |
| `manageBankRecon` | ● |  | ● |  |  |  |  |  | Bank recon / bank accounts / statement lines — Finance + Director only. |
| `manageCustomerCredit` | ● | ● | ● |  |  |  |  |  | Customer credit ledger (cancel of a paid invoice writes a credit note here). |
| `recordPayment` | ● | ● | ● |  |  |  |  |  | Invoice/payment cash collection writes (narrower than recordSales). |
| `manageSaleOrders` | ● | ● | ● |  |  | ● | ● |  | Sale order / delivery wholesale store writes. |
| `manageDeliveries` | ● | ● |  | ● |  | ● | ● |  |  |
| `manageExpenses` | ● | ● | ● | ● | ● | ● | ● | ● | Expense claims — submitters write own rows via merge; approve/reimburse is action-gated. |
| `managePurchaseOrders` | ● | ● | ● | ● |  |  | ● |  | Purchase order wholesale store writes — matches app/api/purchase-orders/[id]/route.ts's WRITE_ROLES. |
| `manageProcurement` | ● | ● |  | ● |  |  |  |  | Return-to-Vendor: stock-deducting and generates a vendor credit note — matches canManageProcurement. |
| `approveDiscount` | ● | ● | ● |  |  |  |  |  | Decide discount/credit approvals (Finance + Director + Admin Officer). |
| `requestSalesApproval` | ● | ● | ● |  | ● | ● | ● |  | Request sales approvals (includes sales_rep so requests persist via store sync). |
| `manageMasterData` | ● | ● | ● |  |  |  |  |  |  |
| `appendAuditLog` | ● | ● | ● | ● | ● | ● | ● |  | Append commercial/finance audit rows (not director-only; reading remains director). |
| `viewAuditLog` | ● |  |  |  |  |  |  |  |  |
| `recordSales` | ● | ● | ● |  | ● | ● |  |  | Commercial document creation: invoices, standalone payments, POS orders and after-sales refunds. Every role that legitimately sells or refun |
| `recordRepairBilling` | ● | ● | ● |  | ● | ● | ● |  | Repair billing: technical leads own the repair-quote lifecycle (quote → client approval → linked invoice), so they may write the invoice led |
| `manageDeposits` | ● | ● | ● |  |  |  |  |  | Layby / deposit ledger — matches the roles granted the deposits module. |
| `manageCompanyProperty` | ● | ● |  |  |  |  |  |  | Office furniture / fittings register — not trading stock, not HR custody. |
| `viewCompanyProperty` | ● | ● | ● |  |  |  |  |  |  |
| `managePayroll` | ● | ● | ● |  |  |  |  |  | Payroll runs and payslips — matches the payroll API role set. |
| `viewReconfiguration` | ● | ● | ● | ● | ● | ● | ● | ● | Device reconfiguration work orders |
| `createReconfiguration` | ● | ● |  |  | ● | ● | ● |  |  |
| `editReconfigurationDraft` | ● | ● |  |  |  | ● | ● |  |  |
| `reserveReconfigurationComponents` | ● |  |  | ● |  |  | ● |  |  |
| `approveReconfiguration` | ● | ● | ● |  |  |  | ● |  |  |
| `performReconfigRemoval` | ● |  |  |  |  |  | ● | ● |  |
| `performReconfigInstallation` | ● |  |  |  |  |  | ● | ● |  |
| `completeReconfigQa` | ● |  |  |  |  |  | ● |  |  |
| `completeReconfiguration` | ● |  |  | ● |  |  | ● |  |  |
| `overrideReconfigCompatibility` | ● |  |  |  |  |  | ● |  |  |
| `overrideReconfigStock` | ● |  |  | ● |  |  |  |  |  |
| `overrideMinimumMargin` | ● |  | ● |  |  |  |  |  |  |
| `reverseReconfiguration` | ● |  | ● |  |  |  | ● |  |  |
| `viewReconfigComponentCosts` | ● | ● | ● | ● |  |  | ● |  |  |
| `viewReconfigSellingPrices` | ● | ● | ● |  | ● | ● | ● |  |  |
| `viewReconfigAccounting` | ● |  | ● |  |  |  |  |  |  |

Observations:
- `manageUsers` is Director-only; `viewUsers` is DIR/ADM. `viewAuditLog` is Director-only (`/api/admin/audit`).
- `postFinancial` (post journals, customer invoice payment) is DIR/FIN/ADM, but the **manual-journal API** (`POST /api/accounting/journals`) additionally requires DIR/FIN (it does not use `postFinancial`).
- `manageBankRecon` (bank accounts, reconciliation, statement lines) is DIR/FIN only.
- `overrideMinimumMargin` is DIR/FIN; `reverseReconfiguration` is DIR/FIN/TL.
- `technician` holds only reconfiguration actions (`viewReconfiguration`, `performReconfigRemoval`, `performReconfigInstallation`); all other repair permissions for technicians are enforced by record-level checks and client guards, not by named permissions.

## 4. Route protection summary

The full per-endpoint gate is in [`ERP_API_REFERENCE.md`](./ERP_API_REFERENCE.md). Aggregates for the 270 route files:

| Gate class (method-level endpoints) | Count |
|---|---|
| role-gated (inline role list / requireRole) | 200 |
| permission-gated (roleMatrix) | 33 |
| store-key ACL (session + store policy) | 8 |
| session, rows scoped to the caller | 8 |
| session + inline role/module logic | 25 |
| session-only (no role check) | 68 |
| secret / provider-verified | 19 |
| public or self-authenticated | 33 |
| re-export of another route | 8 |
| other / see source | 9 |
| **Total** | **411** |

_Counts are derived from the static gate detection described in the API reference header; the "session-only (no role check)" row includes endpoints explicitly marked ⚠ in the table._

Gate semantics worth knowing:
- **Pages** (`app/(app)/**`): the server layout (`app/(app)/layout.tsx`) only checks that a session exists (redirect to `/login`). It does **not** check module grants; the sidebar hides links (`hasModuleAccess`) and each module component applies its own role checks. A user can open `/finance` by URL; the data is protected by the APIs and by store read filters, not by the page.
- **Public/customer routes**: `/portal/*`, `/track/*`, `/api/portal/*` use customer verification (phone on file / signed link, `CUSTOMER_PORTAL_SECRET`), not roles.
- **Partner API**: `/api/public/v1/*` authenticates with `deed_pk_…` keys (SHA-256 hashed in `partner_api_keys`), scope-limited (`__tests__/partner-api-scope-boundary.test.ts`), CORS from `PARTNER_CORS_ORIGINS`.

## 5. Wholesale-store write ACL (`STORE_WRITE_POLICIES`)

The legacy store endpoints `POST /api/store` and `PUT /api/store/[key]` call `canWriteStoreKey(user, key)`: the key must be registered, the role must be in the key's list, and — **unless the user is `director`** — the user must hold at least one of the listed module grants. A key without an entry is denied. This is the *effective* write control for most legacy collections.

| Store key | Write roles → DIR | ADM | FIN | INV | KIL | SALES | TL | TECH | Module grant required (non-director) |
|---|---|---|---|---|---|---|---|---|---|
| `deed_companySettings` | ● | ● |  |  |  |  |  |  | settings |
| `deed_systemSettings` | ● |  |  |  |  |  |  |  | settings |
| `deed_profileImages` | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `deed_departments` | ● | ● |  |  |  |  |  |  | hr, settings |
| `deed_contracts` | ● | ● |  |  |  |  |  |  | hr |
| `deed_customerContracts` | ● | ● |  |  |  | ● |  |  | crm, sales |
| `deed_hrDocuments` | ● | ● |  |  |  |  |  |  | hr, my_documents |
| `deed_workflowApprovals` | ● | ● | ● |  |  |  |  |  | sales, accounting |
| `deed_employeeAssets` | ● | ● |  |  |  |  |  |  | hr |
| `deed_leaveBalances` | ● | ● |  |  |  |  |  |  | hr |
| `deed_leaveRequests` | ● | ● |  |  |  |  | ● |  | hr, leave |
| `deed_salaryAdvances` | ● | ● |  |  |  |  |  |  | hr |
| `deed_jobPostings` | ● | ● |  |  |  |  |  |  | hr |
| `deed_candidates` | ● | ● |  |  |  |  |  |  | hr |
| `deed_trainingPrograms` | ● | ● |  |  |  |  |  |  | hr |
| `deed_employeeTrainings` | ● | ● |  |  |  |  |  |  | hr |
| `deed_hr_sops` | ● | ● |  |  |  |  |  |  | hr, sops |
| `deed_hr_perf_targets` | ● | ● |  |  |  |  |  |  | hr |
| `deed_products` | ● | ● |  | ● |  |  | ● |  | inventory |
| `deed_productPriceHistory` | ● | ● |  | ● |  |  | ● |  | inventory |
| `deed_serials` | ● | ● |  | ● |  |  | ● |  | inventory, repair |
| `deed_bulkStock` | ● | ● |  | ● |  |  | ● |  | inventory |
| `deed_stockTransfers` | ● | ● | ● | ● |  |  | ● |  | inventory |
| `deed_stockAdjustments` | ● | ● | ● | ● |  |  | ● |  | inventory |
| `deed_stockReservations` | ● | ● |  | ● |  | ● | ● |  | inventory, sales, pos |
| `deed_openingStockPosted` | ● | ● |  | ● |  |  | ● |  | inventory |
| `deed_stockMoves` | ● | ● | ● | ● |  |  | ● |  | inventory, pos |
| `deed_refurbishmentJobs` | ● | ● | ● |  |  |  | ● | ● | refurbishment, repair |
| `deed_receipts` | ● | ● |  | ● |  |  | ● |  | purchase, inventory |
| `deed_saleOrders` | ● | ● | ● |  | ● | ● | ● |  | sales |
| `deed_quotes` | ● | ● | ● |  | ● | ● | ● |  | sales, crm |
| `deed_invoices` | ● | ● | ● |  |  | ● | ● |  | sales, accounting, repair |
| `deed_payments` | ● | ● | ● |  |  |  |  |  | accounting, sales |
| `deed_deliveries` | ● | ● |  | ● |  | ● | ● |  | delivery, sales |
| `deed_warranties` | ● | ● | ● |  | ● | ● | ● | ● | sales, repair, after_sales |
| `deed_approvalRequests` | ● | ● | ● |  | ● | ● | ● |  | sales |
| `deed_documentPaymentDetails` | ● | ● | ● |  |  | ● |  |  | accounting, sales |
| `deed_customerCredits` | ● | ● | ● |  |  |  |  |  | accounting, sales |
| `deed_contacts` | ● | ● | ● | ● | ● | ● | ● |  | contacts, crm, sales, purchase, pos, repair, delivery, after_sales, outsource, accounting |
| `deed_companies` | ● | ● | ● |  | ● | ● | ● |  | crm |
| `deed_contactPersons` | ● | ● | ● |  | ● | ● | ● |  | crm |
| `deed_opportunities` | ● | ● | ● |  | ● | ● | ● |  | crm |
| `deed_purchaseOrders` | ● | ● | ● | ● |  |  | ● |  | purchase |
| `deed_purchaseReturns` | ● | ● |  | ● |  |  | ● |  | purchase |
| `deed_repairs_v2` | ● | ● | ● | ● |  |  | ● | ● | repair, outsource |
| `deed_outboundReleases` | ● | ● | ● |  |  |  | ● | ● | repair, after_sales |
| `deed_outsourceJobs` | ● | ● | ● | ● |  |  | ● | ● | repair, outsource |
| `deed_outsourceVendors` | ● | ● |  | ● |  |  | ● |  | outsource, repair |
| `deed_outsourcePayments` | ● | ● | ● |  |  |  |  |  | outsource, accounting |
| `deed_accounts` | ● | ● | ● |  |  |  |  |  | accounting |
| `deed_bankAccounts` | ● | ● | ● |  |  |  |  |  | accounting |
| `deed_bankRecons` | ● |  | ● |  |  |  |  |  | accounting |
| `deed_bankStatementLines` | ● |  | ● |  |  |  |  |  | accounting |
| `deed_journalEntries` | ● | ● | ● |  |  |  |  |  | accounting |
| `deed_expenses` | ● | ● | ● | ● | ● | ● | ● | ● | expenses, accounting |
| `deed_deposits` | ● | ● | ● |  |  |  |  |  | deposits, accounting |
| `deed_refundPayments` | ● | ● | ● |  |  | ● |  |  | after_sales, accounting |
| `deed_payrollRuns` | ● | ● | ● |  |  |  |  |  | hr, accounting |
| `deed_posOrders` | ● | ● | ● |  | ● | ● |  |  | pos |
| `deed_posSessionOpen` | ● | ● | ● |  | ● | ● |  |  | pos |
| `deed_posSessionOpeningCash` | ● | ● | ● |  | ● | ● |  |  | pos |
| `deed_posSessionId` | ● | ● | ● |  | ● | ● |  |  | pos |
| `deed_posSessions` | ● | ● | ● |  | ● | ● |  |  | pos |
| `deed_riders` | ● | ● |  |  |  |  |  |  | delivery |
| `deed_deliveryJobs` | ● | ● |  | ● |  | ● | ● |  | delivery |
| `deed_riderWeeklyPays` | ● | ● | ● |  |  |  |  |  | delivery, hr |
| `deed_returnOrders` | ● | ● | ● |  |  | ● | ● |  | after_sales |
| `deed_buyBacks` | ● | ● | ● | ● |  | ● | ● |  | after_sales, repair, inventory |
| `deed_donations` | ● | ● |  |  |  |  |  |  | after_sales |
| `deed_clientExchanges` | ● | ● | ● |  |  | ● | ● |  | after_sales |
| `deed_kilimallOrders` | ● | ● |  |  | ● |  |  |  | kilimall |
| `deed_kilimallDispatches` | ● | ● |  | ● | ● |  |  |  | kilimall |
| `deed_kilimallSettlements` | ● | ● | ● |  | ● |  |  |  | kilimall |
| `deed_sops` | ● | ● |  |  |  |  |  |  | sops |
| `deed_sopActuals` | ● | ● | ● | ● | ● | ● | ● | ● | sops |
| `deed_ref_sops` | ● | ● | ● |  |  |  | ● | ● | sops, refurbishment |
| `deed_holdovers` | ● | ● | ● | ● | ● | ● | ● |  | holdovers |
| `deed_companyAssets` | ● | ● |  |  |  |  |  |  | property |

Defects visible in this table (see KI-13):
- `deed_companySettings` and `deed_systemSettings` require module `settings`, and `deed_companyAssets` requires module `property`. Neither string is a valid `ModuleId`, so a non-director can never satisfy the module check; in practice only the Director can write these keys even where the role list includes admin_officer.
- `deed_expenses` and `deed_sopActuals` are writable by **all** operational roles (self-service submission), so row-level protection of expenses relies on the content filter and the server merge (`mergeFilteredStoreWrite`), not on this table.
- `deed_journalEntries` is writable by DIR/ADM/FIN with the accounting module — the client can still push journal rows into the legacy blob; the server applies `mergeAppendOnlyJournals` (refuses modification of existing entries) and Prisma remains the reporting source.

### 5.1 Read policies and row slicing

- `SENSITIVE_STORE_KEY_READ_PERMISSIONS`: payroll runs/payslips (`managePayroll`), salary advances and rider weekly pay (`manageHR`), leave requests/balances and HR documents (`viewHrRecords`), journal entries and accounts (`postFinancial`), bank accounts (`postFinancial`), bank recons/statement lines (`manageBankRecon`), customer credits (`manageCustomerCredit`), audit logs (`viewAuditLog`), company assets (`viewCompanyProperty`).
- `COLLABORATIVE_STORE_READ_POLICIES` require role **and** module for `deed_saleOrders`, `deed_repairs_v2`, `deed_contacts`, `deed_products`.
- Row slices (`filterStoreValueForRole`): invoices — DIR/FIN/ADM all; TL/TECH only repair-linked; SALES/KIL only `customer_invoice`; INV only `vendor_bill`; expenses — DIR/FIN all, others own claims; sale orders and opportunities — SALES own (created/assigned); repairs — DIR/ADM/FIN/TL/INV all, technicians assigned-or-created.
- **Bypass note:** these slices apply to `/api/store*`. The Prisma-backed `GET /api/invoices` returns all rows to any authenticated user (KI-08).

## 6. Record-level restrictions

`canAccessRecord(role, model, record, userId, {actsAsTechnician})` — implemented for `sale_order`, `opportunity`, `repair`, `expense`:

| Model | Full access | Restricted |
|---|---|---|
| sale_order | DIR, ADM, FIN, TL | SALES: `createdByUserId` or `salespersonId` = self; others none |
| opportunity | DIR, ADM, FIN, KIL, TL | SALES: `ownerId`/`assignedToId` = self |
| repair | DIR, ADM, FIN, TL | TECH (or `actsAsTechnician`): `assignedTechnicianId`/`createdByUserId` = self |
| expense | DIR, FIN, ADM | others: `submittedByUserId` = self |

Used by `/api/repairs/[id]`, `/api/repairs/[id]/parts-cogs`, sale-order and opportunity routes (selected), store merges. Not applied to invoices or payments.

## 7. Finance-sensitive permissions

| Capability | Who (server) | Notes |
|---|---|---|
| Post/confirm a customer invoice | DIR, FIN, ADM, TL (repair-linked) via `/api/invoices/[id]` | Client action `postInvoice` additionally applies `canPostOrPayCustomerInvoice` |
| Register invoice payment | DIR, FIN, ADM | ADM limited by segregation-of-duties threshold `accAdminOfficerInvoiceLimitKes` (setting; default `DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES` = KES 1,000,000 in `lib/finance-controls.ts`) when paying an invoice they posted |
| Reset/cancel a posted invoice | DIR, FIN, ADM (`canCancelOrResetInvoice`) | Blocked when `amountPaid > 0` (reset) or paid (void) |
| Manual journal | DIR, FIN | `/api/accounting/journals` |
| System journals (6 kinds) | holder of the governing store-key write ACL | KI-06 |
| Fiscal period close | DIR, FIN | Reopen: DIR only; month-end force certify: DIR only |
| Fiscal lock date | DIR, FIN | no audit event (KI-09) |
| Bank reconciliation / bank accounts | DIR, FIN (`manageBankRecon`) | enforced client-side for lock state |
| Expense approve / pay / reimburse | DIR, FIN (`/api/expenses/post-journal`, `canReviewExpense`, `canReimburseExpense`) | submit: everyone |
| Payroll approve/post/pay | `approvePayroll` DIR, FIN; `managePayroll` DIR, ADM, FIN | `/api/payroll/[id]` |
| Credit/discount approval | `approveDiscount` DIR, ADM, FIN | thresholds in `ApprovalRule` + `sales-approval-rules` |
| Margin override | DIR, FIN | `overrideMinimumMargin` |
| Cost visibility | `viewPurchaseCost` DIR, ADM, FIN, INV; `viewReconfigComponentCosts` DIR, ADM, FIN, INV, TL | |
| Customer credit ledger | `manageCustomerCredit` DIR, FIN, ADM | |
| Vendor return (stock-deducting) | `manageProcurement` DIR, ADM, INV | |

## 8. Repair and technical-team permissions

Server-side: `/api/repairs*` require DIR/ADM/TL/TECH (plus module `repair`; reads via `canAccessRecord`); photo/QC/diagnosis report uploads require DIR/ADM/TL/TECH + repair module; `/api/repairs/[id]/parts-cogs` DIR/ADM/TL/TECH with the record firewall; server transition guard refuses arrival at `ready`, `verified_released`, `delivered`, `collected`, `closed` from an illegal predecessor.

Client-side only (`lib/store.tsx`, **not repeated server-side**): verify intake (TL/DIR/ADM), assign technician (`isRepairAssignerRole`), log diagnosis (assigned technician, TL, DIR), generate quote (DIR/TL/ADM/SALES/FIN or assigned technician), start/complete repair (assigned technician), complete QC (DIR/TL, never the technician who did the work), leave-with-Deed/retain (DIR/ADM/TL), plus the full status machine `REPAIR_TRANSITIONS` (only five target statuses enforced on the server).

## 9. Administrator capabilities (Director)

User creation/edit/deactivation, session revocation (`/api/admin/invalidate-sessions`, `/api/admin/security/sessions*`), environment/security overview (`/api/admin/security/env|overview|provenance`), audit export (`/api/admin/audit`), data reset and blob cutover (`/api/admin/reset`, `/blob-cutover`, 3/hour), backfills, bulk import (`/api/import`), force month-end certification, period reopen, contact merge, MFA reset (`/api/admin/users/[id]/mfa`), Settings navigation, Jarvis ingest.

## 10. Permission gaps and client-side-only checks

| ID | Finding | Evidence |
|---|---|---|
| P-1 | Module grants are not enforced on page routes; only API/store gates protect data | `app/(app)/layout.tsx`, `components/AppShell.tsx` |
| P-2 | `canManageInventoryControl` (client) includes finance_officer; `roleMatrix` `manageInventoryApprovals` does not | `lib/store.tsx:2622` vs `lib/auth/authorization.ts` |
| P-3 | 68 method-level endpoints have **no role check** beyond a valid session (including `POST /api/deliveries/[id]/validate`, `POST /api/deposits/[id]/payments`, `POST /api/mpesa/stk-push`, `POST /api/notifications/bridge`, `POST /api/doc-numbers`, `GET /api/invoices`, `PATCH /api/outbound-releases/[id]`, `POST /api/quotes/send`, `POST /api/integrations/send-quote\|send-rfq`, company/contact-person CRUD) | [API reference](./ERP_API_REFERENCE.md) rows marked `session-only (no role check)` |
| P-4 | Three alias tables and three role lists (TypeScript union, Prisma enum, per-route arrays) must be kept in sync by hand | `lib/auth/*` |
| P-5 | Settings/property store keys can never be written by non-directors (invalid module ids) | `store-write-policy.ts` |
| P-6 | `SENSITIVE_STORE_KEY_PERMISSIONS` (older table) and `STORE_WRITE_POLICIES` (newer table) overlap with different role sets (e.g. `deed_payments`: `recordPayment` = DIR/FIN/ADM vs policy FINANCE = DIR/ADM/FIN) — which one is active for a given path must be checked per call site | `lib/auth/authorization.ts`, `lib/auth/store-write-policy.ts` |
| P-7 | Segregation-of-duties (ADM paying own posted invoice) is checked in the payment route inside a `try/catch` that swallows errors (`catch {}`) — a failure of the SoD lookup lets the payment proceed | `app/api/invoices/[id]/payments/route.ts` |
| P-9 | Nine named permissions are defined but never checked anywhere (`approvePayroll, manageInventoryApprovals, printInventoryLabels, viewVendorInventoryLedger, viewPurchaseCost, createCustomerInvoiceFromSO, reverseReconfiguration, viewReconfigSellingPrices, viewReconfigAccounting`); 22 more are used only to build the legacy store-key maps. Product cost is returned by `GET /api/products` to every session | `lib/auth/authorization.ts`, `app/api/products/route.ts` |
| P-8 | Role/permission changes: a user's role change takes effect via `sessionVersion`/validity cache; JWT `modules` are copied at login (module changes require re-login unless the cache path refreshes them — not verified) | `lib/auth/session-validity.ts` |

## 11. Role × capability quick matrix (server-enforced, derived from the endpoint gates)

| Capability | DIR | ADM | FIN | INV | KIL | SALES | TL | TECH |
|---|---|---|---|---|---|---|---|---|
| Create/edit users | ● | | | | | | | |
| Create quotation / sale order | ● | ● | ● | | | ● (own) | ● | |
| Confirm sale order | ● | ● | repair-linked only | | | ● | repair-linked only | |
| Cancel/reset confirmed SO | ● | ● | ● | | | | | |
| Create customer invoice from SO | ● | ● | ● | | | | | |
| Post / reset invoice | ● | ● | ● | | | | ● (API allows any invoice; intended repair-linked) | |
| Register customer payment | ● | ● (SoD limit) | ● | | | | | |
| Manual journal | ● | | ● | | | | | |
| Close fiscal period | ● | | ● | | | | | |
| Reopen fiscal period | ● | | | | | | | |
| POS charge / record order | ● | ● | ● | | ● | ● | | |
| Validate GRN | ● | ● | | ● | | | | |
| Validate delivery (API; session-only) | ● | ● | ● | ● | ● | ● | ● | ● |
| Release outbound (verify/release) | ● | ● | | | | | | |
| Repair create/update (API) | ● | ● | | | | | ● | ● (own) |
| Approve payroll | ● | | ● | | | | | |
| View audit log | ● | | | | | | | |
