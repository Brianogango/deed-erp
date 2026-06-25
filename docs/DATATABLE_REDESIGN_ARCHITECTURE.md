# Enterprise Data Presentation Redesign — Architecture & Audit

Status: **architecture only — no code has been changed.** This is the
pre-implementation deliverable requested before any migration begins.
Everything below is based on a full inspection of `components/modules/**`,
`components/ui/index.tsx`, `components/layout/**`, and `app/globals.css` —
not assumptions.

The single most important finding, stated up front because it changes the
shape of every recommendation below:

> **A genuinely well-built generic `Table` component, plus `RecordCard`
> (mobile card row), `Pagination`, `StatePanel`, `Badge`, `FilterChip`,
> `SearchInput`, and `ExportButtons` already exist in
> `components/ui/index.tsx`.** They support resizable columns, sticky
> headers, localStorage-persisted column widths, loading/error/empty
> states, density (cozy/compact, already wired to a `body` attribute and a
> Topbar toggle), and mobile `data-label` injection for card-mode rendering.
> They are used correctly in only ~4 places (`HRLeaveTab`, `HRPayrollTab`,
> `Settings`, `HRSettings`). Every other module reinvented its own table
> from scratch instead of reaching for these. **The redesign is therefore
> not "build a DataTable from zero" — it is "finish and harden the table
> system that already exists, then force every module onto it."** This is
> lower risk and faster than a ground-up rebuild, and it's why this plan
> recommends evolution over replacement.

---

## 1–4. Complete UI Audit, Table Audit, Table Inventory & Classification

These four deliverables are combined into one master table because the
underlying fact-base is the same: every table-like block in the ERP, what
it does, how it's built today, and what class (A/B/C) it should become.

Legend for **Pattern**: `<table>` = semantic HTML table · `grid-div` =
CSS Grid `.table-head`/`.table-row` div pattern (hand-rolled, the most
common offender) · `flex-card` = flex/divide-y card list · `Table()` =
already uses the shared `components/ui` `Table` component · `RecordCard()`
= already uses the shared mobile card component.

### Sales, CRM, Contacts, Pipeline

| Module / File | Table | Pattern today | Type | Search/Filter/Sort/Page/Bulk | Mobile today |
|---|---|---|---|---|---|
| Sales.tsx | Sale orders list | `<table>`, `hidden lg:block` + mobile cards | **B** | Search, status filter, pagination — no sort, no bulk | Card list exists |
| CRM.tsx | Opportunities (pipeline list) | flex-card | **B** | Search — no filter/sort/page/bulk | Cards are the only view (no desktop table) |
| CRM.tsx | Contracts, Companies, Contacts, Activities (4 lists) | flex-card | **B** | Search only, each duplicated | Cards only |
| CRM.tsx | SLA Active Contracts / Breaches (2 widgets) | grid-div | **A** (summary widgets) | None | `dt-scroll` (intentional small-widget scroll) |
| Contacts.tsx | Contacts list | grid-div, `hidden lg:block` + cards | **B** | Search — no filter/sort/page/bulk | Card list exists |
| RepPerformance.tsx | Rep leaderboard | `<table>` | **B** | None (role-based scope only) | `dt-scroll`, no card view |
| RepPerformance.tsx | Orders this period (drill-in) | `<table>` | **A** | None | None |
| SalesDashboard.tsx | Recent orders | grid-div | **A** (dashboard widget, capped at 8 rows) | None | None — fixed grid risks overflow |
| SalesDashboard.tsx | Top products / Top customers | flex-card | **A** | None | Responsive flex |

### Quotations, Invoices, Finance

| Module / File | Table | Pattern today | Type | Search/Filter/Sort/Page/Bulk | Mobile today |
|---|---|---|---|---|---|
| Accounting.tsx | Invoices list | `<table>`, `hidden lg:block` + cards | **B** | Search, filters — no sort/bulk | Card list exists |
| Accounting.tsx | Refund payments, GRN-linked tables | `<table>` (`.data-table`, self-scrolling) | **C** | None | Intentional scroll (analytical) |
| Accounting.tsx | Line-items form table (inside Invoice/PO form) | `<table>`, `dt-scroll` | **A** (form table, not a list) | N/A | Scrolls — acceptable, it's a form |
| InvoiceDetail.tsx | Invoice line items | `<table>` semantic, clean | **A** | N/A (fixed per invoice) | No card view, but row count is tiny (1–20) |
| InvoiceDetail.tsx | Payment history | flex-card | **A** | None | Single column |
| accounting/PartnerLedgerTab.tsx | Partner ledger | grid-div, `overflow-x-auto` | **C** | None visible | Intentional scroll |
| accounting/GeneralLedgerTab.tsx | General ledger | grid-div, `overflow-x-auto` | **C** | None visible | Intentional scroll |
| accounting/JournalsTab.tsx | Journals | grid-div, `overflow-x-auto` | **C** | None visible | Intentional scroll |
| accounting/ChartOfAccountsTab.tsx | Chart of accounts | grid-div, `overflow-x-auto` | **A** | None | Scroll (8 cols, admin-only, low traffic) |
| Cashbook.tsx | Cashbook entries | grid-div, `overflow-x-auto` | **C** | None visible, capped scroll height | Intentional scroll |
| Cashbook.tsx | Bank statement lines, matched pairs, unmatched (4 tables) | grid-div | **C** | Manual match action only | None |
| Cashbook.tsx | Reconciliation summary | grid-div | **B** (small, per-account) | None | `overflow-x-auto` |
| Deposits.tsx | Deposits list | `Table`-style semantic `<table>`, `hidden lg:block` + cards | **B** | Search, status filter — no sort/bulk | Card list exists |
| Expenses.tsx | Expense table (shared component) | `<table>` with responsive `hidden md/lg:table-cell` | **B** | Search, filters — no sort/bulk | Column-priority hiding (closest thing to the target pattern already in prod) |

### Inventory, Products, Procurement

| Module / File | Table | Pattern today | Type | Search/Filter/Sort/Page/Bulk | Mobile today |
|---|---|---|---|---|---|
| Inventory.tsx | Product list (×2 — main + a second 8-col variant) | grid-div, `overflow-x-auto` + `min-w` | **B** | Search/filter, no sort/bulk | None — scrolls on mobile |
| Inventory.tsx | Stock on Hand / Opening vs Closing / Movements / Serial Tracking / Low Stock reports (5 tables) | grid-div, `overflow-x-auto` + `min-w` | **C** | Filter toolbar above, no sort | Scroll (legitimate — these are reports) |
| Inventory.tsx | Modal sub-tables (×2, inside dialogs) | grid-div, `overflow-y-auto` | **A** | None | N/A (modal) |
| Outsource.tsx | Outsource jobs | `<table>` with `hidden md/lg/xl:table-cell` | **B** | Search/filter — no sort/bulk | Column-priority hiding (already good) |
| Refurbishment.tsx | Job parts table | grid-div, `min-w-[700px]` | **B** | None | Scrolls, no card view |
| Refurbishment.tsx | Jobs list | grid-div, `min-w-[800px]` | **B** | Status tabs only | Scrolls, no card view |
| Refurbishment.tsx | Parts request inbox | flex-card (non-tabular) | **B** | None | Responsive flex |
| Purchase (PurchaseOrdersTab, PurchaseBillsTab, PurchaseReceiptsTab, PurchaseReturnsTab) | 4 lists | grid-div, `hidden lg:block` + cards | **B** | Filters per tab — no sort/bulk | Card list exists |
| purchase/POFormView.tsx | PO line items (form) | grid-div, `dt-scroll` | **A** (form table) | N/A | Scrolls — acceptable |
| TradeIn.tsx | Buy-back list, Donation list, Exchange list (3 lists) | `<table>`, `overflow-x-auto` + `min-w` | **B** | Search only | None — scrolls |
| TradeIn.tsx | Bulk-upload preview tables (×3) | `<table>` | **A** (transient import preview) | None | Scrolls |
| TradeIn.tsx | Detail line tables (×2) | `<table>` | **A** | N/A | None |

### Repairs, Technicians, Warranty, After-Sales

| Module / File | Table | Pattern today | Type | Search/Filter/Sort/Page/Bulk | Mobile today |
|---|---|---|---|---|---|
| RepairClientJobs.tsx | Repair jobs | `<table>` with `hidden md/lg/xl:table-cell`, `block lg:hidden` cards | **B** | Search, filters, pagination — no sort/bulk | **Best-in-class today** — closest to target pattern |
| RepairDetailView.tsx | Parts used | `<table>`, `dt-wrap` | **A** | N/A (3–5 rows) | None needed |
| RepairDetailView.tsx | Diagnosis history | flex-card | **A** | None | Responsive |
| RepairDetailView.tsx | Issue photos | CSS grid (image gallery, not data) | N/A | N/A | Responsive |
| RepairRefurbJobs.tsx | Refurb jobs (repair-linked) | flex-card | **B** | Status tabs only | Responsive (single layout) |
| AfterSales.tsx | Warranties | grid-div, `hidden lg:block` + cards | **B** | Search, status filter — no sort/bulk | Card list exists |
| AfterSales.tsx | RMA / Returns | grid-div, `hidden lg:block` + cards | **B** | Search, status filter — no sort/bulk | Card list exists |
| OutboundReleasePanel.tsx | Release items (pick step) | `<table>` | **A** | None | None |
| OutboundReleasePanel.tsx | Serial verification | flex-card | **A** | Live validation, not filter | Responsive |
| OutboundReleasePanel.tsx | Release audit log | flex-card (`divide-y`) | **A** | None | Responsive |

### HR, Payroll, Leave, Assets

| Module / File | Table | Pattern today | Type | Search/Filter/Sort/Page/Bulk | Mobile today |
|---|---|---|---|---|---|
| HR.tsx | Employees | `Table`-adjacent semantic `<table>` with `hidden md/lg:table-cell` | **B** | Search — no sort/bulk | Column-priority hiding (good) |
| HR.tsx | System users | semantic `<table>` with `hidden md:table-cell` | **B** | Search — no sort/bulk | Column-priority hiding (good) |
| hr/HRLeaveTab.tsx | Leave requests, Leave balances (2 tables) | **`Table()` shared component** | **B** | Search — no sort/bulk | Handled by `Table`'s built-in mobile mode |
| hr/HRPayrollTab.tsx | Payroll runs, Payslips (2 tables) | **`Table()` shared component** | **B** | Search — no sort/bulk | Handled by `Table` |
| hr/HRPerformanceTab.tsx | Performance targets | flex-card (progress-bar cards) | **B** | None | Responsive |
| hr/HRSalaryAdvanceTab.tsx | Salary advance requests | **`RecordCard()` shared component** | **B** | Status filter | Already the target mobile pattern |
| hr/HRAssetsTab.tsx | Asset assignments | semantic `<table>` with `hidden md:table-cell` | **B** | None | Column-priority hiding (good) |
| hr/HRRecruitmentTab.tsx | Candidates | semantic `<table>` with `hidden md:table-cell` | **B** | None | Column-priority hiding (good) |
| LeaveApplication.tsx | My leaves, All leave requests (2 tables) | grid-div (custom, bespoke) | **B** | Status filter buttons | None — fixed grid |
| Settings.tsx / HRSettings.tsx | Bank accounts, System users, POS daily summary (3 tables ×2 files = 6) | **`Table()` shared component** + manual mobile cards | **B** (users/banks) / **C** (POS summary) | Search on some | Handled by `Table` + custom mobile fallback |

### Documents, SOPs, POS, Kilimall, Reporting

| Module / File | Table | Pattern today | Type | Search/Filter/Sort/Page/Bulk | Mobile today |
|---|---|---|---|---|---|
| SOPs.tsx | Historical comparison | `<table>`, `dt-scroll` | **C** (dynamic period columns) | None | Intentional scroll |
| SOPDocuments.tsx | SOP card grid | CSS grid cards (not tabular) | N/A | Search, dept/status filter | Already card-based |
| MyDocuments.tsx | Expandable SOP reference list | flex-card | **A** | Search, category filter | Already card-based |
| POS.tsx | Product grid | CSS grid cards (not tabular) | N/A | Category filter | Already card-based |
| POS.tsx | Cart items | flex-card | **A** | N/A | Responsive |
| POS.tsx | Transaction history (modal) | grid-div, `min-w-[700px]` | **B** | None | Scrolls inside modal |
| POS.tsx | Recent orders (session-closed view) | flex-card | **A** | None | Responsive |
| Kilimall.tsx | Orders (dashboard + full list), Dispatch history, Settlements, Reconciliation, Settlement-lines, Reports ×2, Returns — **10 separate grid-div tables** | grid-div, `overflow-x-auto` + `min-w` throughout | **B** (orders, dispatch, settlements) / **C** (reports, reconciliation) | Search/status filter on orders only | None anywhere in this file — heaviest debt in the ERP |
| Barcode.tsx | — | Not a table (label renderer) | N/A | N/A | N/A |

**Inventory total: ~95 distinct table/list rendering blocks across 38
files.** Roughly: 38 use the hand-rolled `grid-div` pattern, 22 use a
semantic `<table>`, 28 use a bespoke flex-card list, and only **7** use the
shared `Table()`/`RecordCard()` components that were built to solve exactly
this problem.

---

## 5. Duplicated Components & Reuse Opportunities

| Duplicated thing | Instances | Reuse opportunity |
|---|---|---|
| Hand-rolled `grid-div` table (`.table-head`/`.table-row` with inline `gridTemplateColumns`) | ~38 | Replace with `DataTable` (which wraps the existing `Table()`), eliminating per-module grid math entirely |
| Hand-rolled semantic `<table>` with no shared styling | ~22 | Same — `DataTable` renders either way internally; callers stop hand-writing `<thead>/<tbody>` |
| Bespoke "mobile card list" reimplemented per module (Sales, Contacts, Deposits, Purchase ×4, AfterSales ×2, RepairClientJobs, Outsource, HR, Expenses…) | ~20+ | All replace with `RecordCard` (already exists, already well-designed) driven by the column-priority config — one card renderer, not twenty |
| Status badge color logic re-derived locally (hardcoded hex per module: Kilimall's `STATUS_COLOR`, Refurbishment's `STATUS_LEFT_BORDER`, TradeIn's inline condition colors, etc.) | ~10+ | `Badge`'s existing `statusColor`/`statusLabel` map already centralizes this — extend that one map instead of inventing local ones |
| Search input re-implemented per module (local `<input>` + `useState` + manual `.filter()`) | ~30+ | `SearchInput` already exists — wire it into `DataTableToolbar` once |
| Pagination re-implemented or *absent* (Kilimall, TradeIn, AfterSales, Cashbook, LeaveApplication, RepairRefurbJobs all have **no pagination at all** — they render full filtered arrays) | ~15 modules with none | `Pagination` already exists and is good — `DataTable` makes it mandatory by default for Type B/C tables |
| `overflow-x-auto` + `min-w-[Npx]` used as the *only* responsive strategy | ~35 instances | This is precisely what the new column-priority + card system replaces |
| Export (PDF/Excel) wired ad hoc in a couple of places (Settings POS summary) | 2 | `ExportButtons` exists — make it a standard `DataTableToolbar` slot |

---

## 6. New DataTable Architecture (evolution, not a rebuild)

```
DataTable<T>                          ← new composition root
├── DataTableToolbar                  ← new
│   ├── SearchInput                   ← EXISTING, reused as-is
│   ├── AdvancedFiltersButton         ← new (opens AdvancedFilters panel)
│   ├── SavedViewsMenu                ← new
│   ├── ColumnVisibilityMenu          ← new (writes to TablePreferences)
│   ├── DensitySelector               ← mostly EXISTING (Topbar already has
│   │                                    the toggle + body attribute; this
│   │                                    just exposes the same control
│   │                                    per-table when needed)
│   ├── ExportButtons                 ← EXISTING, reused as-is
│   ├── ImportButton                  ← new (CSV/XLSX upload, module-specific
│   │                                    parser injected via props)
│   ├── RefreshButton                 ← new (thin wrapper, calls onRefresh)
│   ├── BulkActionsBar                ← new (appears when rowSelection > 0)
│   └── CreateNewButton               ← new (slot, module supplies the action)
├── AdvancedFilters (slide panel)     ← new, uses EXISTING SlidePanel
│   └── FilterChip                    ← EXISTING, reused for active filter pills
├── DataTableBody
│   ├── Desktop/Laptop: Table()       ← EXISTING component, extended with:
│   │     • ColumnPinning (new)
│   │     • column priority → visibility (new, feeds existing `cols` prop)
│   │     • row-click → opens DetailsDrawer instead of nothing/navigate
│   ├── Tablet: Table() with reduced  ← same component, fewer visible columns
│   │     column set + RowExpander
│   └── Mobile: MobileCardView        ← thin wrapper around EXISTING
│         (= RecordCard list)            RecordCard, fed by the same column
│                                         config (priority 1 fields only)
├── EmptyState / LoadingSkeleton /    ← EXISTING (StatePanel, StateSkeleton,
│   ErrorState                           TableSkeleton) — already built in
│                                         to Table(), just keep using them
├── Pagination                        ← EXISTING, reused as-is (client mode
│                                         for Type A/B, server mode for Type C)
├── RowActions                        ← new thin convention (a render-prop
│                                         per row, rendered as the last
│                                         column on desktop / action row on
│                                         card)
├── QuickPreview (hover/click peek)   ← new, optional, small popover variant
│                                         of DetailsDrawer for Type B tables
└── DetailsDrawer                     ← EXISTING SlidePanel, extended with a
      ├── Overview tab                   standard tab convention:
      ├── Timeline tab                   Overview / Timeline / Notes /
      ├── Notes tab                      Attachments / History / Activity /
      ├── Attachments tab                Related Records / Audit Log
      ├── History tab
      ├── Activity tab
      ├── Related Records tab
      └── Audit Log tab
```

**Supporting, non-visual pieces:**
- `lib/data-table/types.ts` — `ColumnDef<T>` with `{ key, label, priority: 1|2|3|4, width, sortable, render }`, `TableType: 'A'|'B'|'C'`
- `lib/data-table/use-table-preferences.ts` — generalizes the existing
  per-table `localStorage` column-width persistence (already in `Table()`)
  to also persist: visible columns, density, saved views, pinned columns —
  one hook, one storage shape, replacing the one-off `deed_table_widths_*`
  key with a structured `deed_table_prefs_${tableId}`.
- `lib/data-table/use-server-table.ts` — for Type C only: wraps
  pagination/sort/filter state into query params for an API route,
  debounced search, and exposes loading/error to `DataTable`.

**Why this shape:** every "new" box above is either a thin wrapper around
something that already exists (`SearchInput`, `ExportButtons`, `SlidePanel`,
`RecordCard`, `Table`, `StatePanel`, `Pagination`, `FilterChip`) or a small,
genuinely new piece (`ColumnVisibilityMenu`, `SavedViewsMenu`,
`AdvancedFilters`, `BulkActionsBar`, `ColumnPinning`, `ImportButton`,
`RowActions` convention). No existing component is thrown away.

---

## 7. Component Hierarchy (file layout)

```
components/data-table/
├── DataTable.tsx                  (root — picks desktop/tablet/mobile render)
├── DataTableToolbar.tsx
├── AdvancedFilters.tsx
├── SavedViewsMenu.tsx
├── ColumnVisibilityMenu.tsx
├── ColumnPinning.tsx
├── BulkActionsBar.tsx
├── ImportButton.tsx
├── RefreshButton.tsx
├── MobileCardView.tsx             (wraps RecordCard)
├── DetailsDrawer.tsx              (wraps SlidePanel + tab convention)
├── QuickPreview.tsx
└── index.ts                       (public exports)

lib/data-table/
├── types.ts
├── use-table-preferences.ts
├── use-server-table.ts
└── classify.ts                    (helper: given rowCount + features needed,
                                     suggests Type A/B/C — used at the
                                     authoring stage, not at runtime)
```

`components/ui/index.tsx` is **not duplicated** — `DataTable` imports
`Table`, `RecordCard`, `Pagination`, `Badge`, `SearchInput`, `FilterChip`,
`ExportButtons`, `StatePanel`, `SlidePanel` from it, the same as any module
does today.

---

## 8–10. Responsive Strategy by Breakpoint

This directly encodes the column-priority system into each breakpoint —
priorities are authored once per table (`ColumnDef.priority`), and
`DataTable` decides what's visible:

| Breakpoint | Columns shown | Layout | Notes |
|---|---|---|---|
| **Desktop 1440px+** | Priority 1+2+3 (4 = drawer only) | Full `Table()`, pinned columns, sticky header, hover row actions, bulk action bar when rows selected, full toolbar | No compromises — matches the spec exactly |
| **Laptop 1024–1439px** | Priority 1+2 (3 hidden, 4 = drawer only) | Same `Table()`, density auto-tightens one notch, secondary toolbar actions collapse into an overflow menu | Still a real table, never card-ified |
| **Tablet 768–1023px** | Priority 1 only, with a "+N more in drawer" affordance per row | Same `Table()` component but column set trimmed via priority; row click opens `DetailsDrawer` instead of inline expand; filters move into a slide panel; toolbar collapses to icon buttons | Per your instruction: do **not** squeeze the desktop table — this is the same component rendering fewer columns, not a shrunk version of all of them |
| **Mobile <768px** | Priority 1 fields only, in card form | `MobileCardView` (`RecordCard`), tap → `DetailsDrawer` (or full page for very large entities) | No horizontal scroll, ever, for Type A/B. Type C reporting tables may keep controlled `dt-scroll` exactly as already exists for Cashbook/ledgers/Kilimall reports |

Column priority defaults (overridable per table, but this is the standard
the audit above maps every existing column onto):

- **Priority 1 (always):** primary entity name/ref, counterparty
  (customer/vendor), status, the one headline amount/price.
- **Priority 2 (desktop+tablet):** warehouse/location, assigned
  user/technician, category, the primary date.
- **Priority 3 (desktop only):** created by/updated by, secondary notes,
  tax/discount breakdown, secondary dates.
- **Priority 4 (drawer only):** internal IDs, raw JSON/metadata, full
  history, audit trail.

---

## Details Drawer

Row click never navigates away immediately (except where a module already
has a dedicated full detail *page* that's genuinely worth keeping, e.g.
`RepairDetailView` — those stay as pages; the drawer is for everything that
currently has no detail view at all, which is most Type B tables today).
The drawer is the existing `SlidePanel`, standardized with this tab set:
**Overview · Timeline · Notes · Attachments · History · Activity · Related
Records · Audit Log**, with modules supplying only the tabs that apply
(e.g. a Brands lookup table never gets a drawer at all — Type A tables
generally skip it).

## Table Toolbar

`DataTableToolbar` = `SearchInput` + `AdvancedFiltersButton` +
`SavedViewsMenu` + `ColumnVisibilityMenu` + `DensitySelector` +
`ExportButtons` + `ImportButton` + `RefreshButton` + `BulkActionsBar` (only
visible when rows selected) + `CreateNewButton` (slot) + an optional
`QuickStats` slot (small inline counters, e.g. "12 overdue", reusing the
existing `StatCard`/badge primitives at small size — not a new component).
Note from the Topbar audit: global search (Ctrl+K), density, and sync
status already live in the Topbar — the per-table toolbar's `SearchInput`
is **scoped to that table's visible columns only** and is a distinct,
smaller affordance, not a duplicate of global search.

## Search

Global (Topbar `GlobalSearch`) already exists and is out of scope here.
Per-table search starts as simple substring matching across visible
columns (Type A/B, client-side) and gains `AdvancedFilters` (AND/OR,
contains/starts/ends/equals, date range, number range, relative date,
multi-status, saved filters) as a Type B/C feature — implemented as a
structured filter-state object passed to either the client-side filter
function (Type A/B) or the server query (Type C via `use-server-table`).

## Performance

Type A: full client render, no pagination needed (≤ ~50 rows by
definition of "simple lookup").
Type B: client-side pagination via existing `Pagination`, debounced
search, render only the current page's rows.
Type C: `use-server-table` drives server-side pagination/sort/filter
through a `?page&pageSize&sort&filter=` query contract; virtualization
(windowed rendering) added only for the handful of tables that can exceed
~500 rows in a single fetch (Audit Log, Stock Movements, Cashbook history).
No table renders thousands of unpaginated rows client-side after migration
— this is the #1 concrete performance fix versus today's Kilimall/TradeIn/
Cashbook tables, which currently render full filtered arrays with no cap.

## Accessibility

`Table()` and `RecordCard` already have a reasonable foundation; the gap
found repeatedly in the audit is **icon-only action buttons with no
`aria-label`** (Refurbishment, Kilimall, Cashbook, TradeIn, OutboundRelease
all have this) and **no keyboard row navigation**. `DataTable` adds: arrow
key row navigation, Enter to open drawer, Escape to close, Shift/Ctrl-click
range/multi-select for `BulkActionsBar`, and enforces `aria-label` on every
`RowActions` icon button via the component's own prop contract (the prop
is `label`, not optional) — so this becomes structurally hard to skip
rather than a style-guide reminder.

---

## 11. Migration Roadmap (module order)

Principle: **migrate one module at a time, verify all four breakpoints,
ship, then move on** — never a big-bang swap. Order is chosen by (a) risk
(start where breaking something matters least), (b) how close the module
already is to the target pattern (cheap wins build momentum and validate
the new component), (c) business criticality (save the riskiest, highest-
traffic modules for when the system is proven).

**Phase 0 — Build the foundation (no module migration yet)**
Build `DataTable` + `DataTableToolbar` + `MobileCardView` +
`DetailsDrawer` + `ColumnVisibilityMenu` + `BulkActionsBar` against the
existing `Table`/`RecordCard`/`Pagination`. Unit-test against one
throwaway/internal screen, not a real module yet.

**Phase 1 — Cheap wins / already-closest (validate the component, low risk)**
1. `hr/HRSalaryAdvanceTab.tsx` (already uses `RecordCard` — smallest delta)
2. `Outsource.tsx` (already has column-priority hiding — smallest delta)
3. `RepairClientJobs.tsx` (already best-in-class — proves drawer + bulk
   actions on a real, already-responsive screen)
4. `Expenses.tsx`

**Phase 2 — Type B core workflow tables, medium risk**
5. `Deposits.tsx`
6. `AfterSales.tsx` (Warranties, then RMA)
7. `Contacts.tsx`
8. `Purchase` tabs (Orders, Bills, Receipts, Returns — one at a time)
9. `HR.tsx` (Employees, then System Users) + `HRAssetsTab`, `HRRecruitmentTab`
10. `hr/HRLeaveTab.tsx`, `hr/HRPayrollTab.tsx` (already on `Table()` —
    upgrade in place to the full `DataTable` wrapper)

**Phase 3 — High-traffic core revenue tables (highest business risk — only
after the pattern is proven in Phases 1–2)**
11. `Sales.tsx`
12. `Accounting.tsx` (Invoices)
13. `Inventory.tsx` (Product list)
14. `CRM.tsx` (Opportunities, then Contracts/Companies/Contacts/Activities)
15. `RepairRefurbJobs.tsx`, `Refurbishment.tsx`

**Phase 4 — Heaviest debt, currently worst offenders**
16. `Kilimall.tsx` (10 tables — biggest single effort, do last among Type B
    so the pattern is fully battle-tested first)
17. `TradeIn.tsx`
18. `LeaveApplication.tsx`

**Phase 5 — Type C reporting tables (server-side pagination work is new,
do once the client-side pattern is fully stable)**
19. `Inventory.tsx` reports (Stock on Hand, Movements, Serial Tracking, Low
    Stock, Opening vs Closing)
20. `Cashbook.tsx` (entries, reconciliation tables)
21. `accounting/*Tab.tsx` (Partner Ledger, General Ledger, Journals)
22. `SOPs.tsx` historical comparison
23. New: an actual **Audit Log viewer module** — the audit surfaced that
    `AuditLog`/`AiAuditLog` data exists at the database level but there is
    currently no dedicated UI to browse it. This is a natural Type C
    `DataTable` showcase once built, and a real gap worth flagging
    regardless of this redesign.

**Phase 6 — Type A lookups (lowest priority, lowest value — per your own
classification these should stay lightweight; many may not need full
`DataTable` at all, just the shared `Badge`/`Table` primitives)**
24. Settings.tsx / HRSettings.tsx tables (already on `Table()` — light
    touch-up only)
25. Dashboard/SalesDashboard/RepPerformance summary widgets (these are
    capped-row dashboard widgets, not full tables — leave most as-is, just
    swap their inconsistent inline-styled bits for `Badge`/`StatCard`)
26. Remaining small lookup/reference tables as they're touched for other
    reasons (no dedicated phase needed)

**After each phase:** remove the old per-module implementation only once
the migrated module has been verified at 375/768/1024/1440px and the
business workflow has been smoke-tested (create, edit, filter, paginate,
bulk action if applicable) — never delete the old code in the same change
that introduces the new one.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Big-bang temptation — touching many modules at once because "it's all the same change" | Roadmap explicitly enforces one module per change, with its own review/test pass |
| The existing `Table()` component is lightly battle-tested (4 real usages today) and may have latent bugs at scale (large column counts, many rows) | Phase 1 deliberately picks small, low-risk modules first to surface issues before Phase 3's high-traffic tables |
| Business logic regressions during migration (filters/search silently dropping a previously-supported query, bulk action wired to wrong endpoint) | Hard rule: migration changes presentation only; every existing API call, validation, and permission check is carried over unchanged — verified by diffing behavior, not just visuals |
| Long transition period with two table systems live simultaneously (inconsistent UX while mid-migration) | Accepted tradeoff, time-boxed per phase; sidebar/topbar already signal which modules are "new" if needed via a small visual cue, no functional impact |
| Type C server-side pagination introduces new API surface (new query params, new endpoints for Cashbook/Ledger/Audit Log) | Treat each as its own small, additive API change reviewed independently — same caution as any other backend change, never bundled silently into a UI PR |
| Column-priority defaults won't match real user needs for every table | Make `ColumnVisibilityMenu` + `TablePreferences` persist a per-user override from day one, so a wrong default is a one-click fix for the user, not a re-deploy |
| Scope creep — "while we're in here, let's also redesign the workflow" | Explicit non-goal, restated from your brief: never change business logic; this is presentation-only |
| Accessibility additions (keyboard nav, aria-labels) could be skipped under time pressure since they're invisible to a casual demo | Bake them into `DataTable`'s required props (e.g. `RowActions` icon buttons require a `label` prop, not optional) so skipping them is a type error, not a habit |

## 13. Estimated Implementation Order (summary)

Phase 0 (foundation) → Phase 1 (4 cheap-win modules) → Phase 2 (≈10 Type B
core modules) → Phase 3 (5 high-traffic revenue modules) → Phase 4 (3
heaviest-debt modules, Kilimall largest single effort) → Phase 5 (Type C
reporting, including a net-new Audit Log viewer) → Phase 6 (Type A
lookups, lowest effort, can interleave with anything above once the
component is stable).

---

### What this plan deliberately does *not* do yet
No code in this turn. No business logic changes anywhere, ever, in this
redesign. No new backend endpoints until Phase 5 specifically calls for
them for Type C server-side pagination, and even then as their own
reviewed change. Awaiting approval before Phase 0 begins.
