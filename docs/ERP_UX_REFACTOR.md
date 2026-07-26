# ERP UX refactor — focused operational chrome

This pass establishes reusable layout rules and applies them across modules.
Business logic, APIs, and permissions are unchanged.

## Design rules

1. One primary action per page (top-right, brand accent).
2. Module navigation shows at most six tabs; overflow goes into **More**.
3. Operational lists prioritise search → frequent filters → content.
4. Analytics stay on the central dashboard or dedicated report tabs.
5. Status uses the shared `StatusBadge` / `Badge` map (sentence case).
6. Content width max 1440px with responsive gutters (16 / 24 / 32px).
7. Progressive disclosure for secondary actions (overflow menus, drawers, collapsible form sections).

## Shared components (`components/erp/`)

| Component | Purpose |
|---|---|
| `ModuleChrome` | ModuleHeader + TabBar + body shell |
| `ResponsivePageContainer` | Max-width page container |
| `PageToolbar` | Search / filters / view / actions strip |
| `PrimaryActionButton` | Dominant CTA |
| `SecondaryActionMenu` | Overflow for rare / destructive actions |
| `StatusBadge` | Canonical status pill |
| `FormSection` | Progressive form grouping |
| `RecordHeader` | Record detail header |
| `FilterDrawer` | Advanced filters surface |
| `OperationalSummary` | Compact list counters (not charts) |
| `PermissionDeniedState` | Access denied panel |

Also strengthened in `components/ui`: `ModuleHeader`, `TabBar` (≤6 visible), `Badge` labels, `EmptyState` sentence case.

## Module entry points

| Module | Opens to |
|---|---|
| Sales | Quotations / Orders |
| Accounting | Invoices (then Bills, Refunds, Journals, Reports, Cashbook; Accounts/Ledgers/Migration in More) |
| Inventory | Catalog first (Products, Warehouse, Movements, Stock take, Transfers, Reports primary; rest in More) |
| Repairs | Active jobs |
| Purchases / CRM / HR / Delivery / others | Existing primary operational tabs via shared chrome |

## Dashboards

- Central dashboard at `/` remains the single role-aware overview.
- Module KPI strips stay removed; list pages may show compact operational summaries only.
- Dashboard hero/stat styling calmed (navy/blue brand, less purple decoration).

## Follow-up / manual review

- Repair detail still has dense secondary panels below the header — consider tabbing Activity / Attachments / Audit.
- Sales / Inventory / Accounting list tables not fully migrated to shared `DataTable` yet.
- Capture visual-regression screenshots with `npm run screenshots:core` when credentials are available.
