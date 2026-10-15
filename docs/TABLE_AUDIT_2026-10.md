# ERP table audit — October 2026

Scope: every table implementation in `app/` and `components/`. Standard: the master table system in
[`TABLE_PAGE_SYSTEM.md`](./TABLE_PAGE_SYSTEM.md) (48px rows, 40px header, 12px padding, right-aligned
figures, one compact badge, container-driven columns).

## Inventory

| Kind | Count | Notes |
|---|---|---|
| `<DataTable>` (grid, server/client, selectable, mobile cards) | 98 instances in 44 files | all inherit the master layer |
| Raw `<table>` standardised to `.erp-table` | 51 | reports, editable lines, admin tools, settings, modals |
| Raw `<table>` with a legacy module class | 27 | `sp-table` (sales), `invoice-detail__table`, `reconfig-table`, `contacts-compact-table`, `accounting-dashboard__table`, `data-table` — now selectors of the same rules |
| Core `Table` primitive (`components/ui`) | 1 | the grid builder every DataTable uses |
| **Total audited** | **177** | |
| Left unchanged on purpose | 3 | customer tracking page, customer quote portal (dark public theme), printable proforma preview (document, not a data table) |

## Root cause of the Invoices screenshot

Three independent defects stacked:

1. **Grid builder** (`components/ui` `Table`): fixed columns were `minmax(floor, Npx)` — capped at their pixel
   width — while the name column was `minmax(12rem, 2fr)`. All free space therefore went to Customer
   (1,044px beside 100px figures at 1920).
2. **Finance override** (`globals.css`): `grid-template-columns: 36px 110px minmax(0,2fr) … !important` on
   `.finance-content-card--invoices` (same flaw, and it overrode the user's column picker), plus 58px rows,
   9px upper-case headers and `padding-block: .75rem`.
3. **Stacked badges**: the payment-status cell wrapped "Not paid" over "Overdue", doubling row height
   (73–101px).

## Corrections

Per-module counts are source occurrences (one definition may render on several tabs), so they are approximate.

| Module | Tables | Issues found | Corrections | Verification |
|---|---|---|---|---|
| Shared grid (`ui/Table`, `DataTable`) | 1 + 98 | Fixed tracks capped at px, one flexible column hogging slack; select/actions growing; defaults ignored breakpoint; 10-column catalogs clipped at 1440 | Proportional tracks, `fixed` select/actions, floors (80 / status 140 / figures 88), breakpoint-aware defaults, `fitColumnsToWidth` progressive disclosure, centred checkbox | Harness at 1920/1366/900/390; Inventory catalog measured 1,083px container, no scroll; unit tests |
| Finance — Invoices / Bills | 1 (×2 tabs) | **Critical**: forced grid, 73–101px rows, stacked badges, forced 960px scroll, tablet card override | Override removed, nowrap badges, due date → desktop priority, per-column floors, dead tablet-card CSS deleted | Replica at 1920/1366/900/390, before/after |
| Finance — accounting tabs (Journals, GL, Partner ledger, Ageing, Cash flow, COA, Commissions, Credits, Refunds, Integrity) | 12 | Module-specific heights/type; money not right-aligned (Journals Total, COA Balance) | Inherit master; `align: 'right'` added | Typecheck; not rendered (needs data) |
| Finance — dashboard tables | 3 | **Major**: 7.7–9.6px type, left-aligned money, 0.48rem status text | Type onto master scale, numeric columns `is-num` | Style review only |
| Finance — integrity/repair tools | 15 | Ad-hoc `text-[11px]`, per-cell padding | `.erp-table` | Style review |
| Sales / Quotations / Orders | 10 | Three stacked `!important` geometry layers (head 40/42px, 9–11px caps, td 6–12px padding) | Duplicates stripped; one rule set. Dashboard Total right-aligned | Style review; needs data |
| Sales prototype routes | 11 | Same `.sp-table` layers | Same | Not rendered |
| Contacts / CRM / Leads | 12 | 58px rows, 10px caps, 13px cell padding | Inherit master; geometry removed | Not rendered |
| Inventory / Stock / Serials | 20 | Qty not right-aligned; catalog clipped "Last upd…/Actions" | Alignment; progressive disclosure | `/inventory` measured before/after |
| Purchase (orders, receipts, bills, returns, PO lines) | 6 | 58px rows; line grid | Inherit master | Not rendered |
| Delivery, Deposits, Holdovers, Expenses, HR (8 tabs), Repairs, Reconfig, Outsource, AfterSales, TradeIn, Refurbishment | ~30 | 56–62px rows, 9–10px caps; TradeIn inline-styled tables | Inherit master; TradeIn → `.erp-table` | Typecheck; not rendered |
| Kilimall, E-commerce, Rep performance, Settings | ~25 | Money columns left-aligned (≈30 columns) | `align: 'right'` | Typecheck |
| Mobile record view (`MobileCardView`, `RecordCard`) | every DataTable | Tall boxed cards; status and amount hidden | Title / status / amount header, flat label–value pairs | Screenshot at 390px |
| POS | 0 | No table implementation found | — | — |

## Files, tokens and shared components

- Tokens: `--table-row-height`, `--table-head-height`, `--table-pad-x`, `--table-col-gap`, `--table-head-fs`.
- Shared: `components/ui/index.tsx` (grid builder, `RecordCard`), `components/data-table/DataTable.tsx`,
  `components/data-table/MobileCardView.tsx`, `lib/data-table/fit.ts` (+ tests),
  `components/erp/horizon-table-alignment.css` (now the single master layer).
- Removed competing geometry from 30 module rules in `app/globals.css`, `odoo-record-designs.css`,
  `sales-prototype.css`, `contacts-financial-hierarchy.css`.

## Not verified

No database is available in this environment, so populated tables inside real modules could not be rendered.
Verification used (a) a harness mounting the real `DataTable` with the production column definitions for
Invoices plus long names, large values, zero balance, multiple statuses, selection, actions, empty state and
editable raw tables, at 1920 / 1366 / 900 / 390px in light and dark theme; (b) the real app shell in
`VISREG_BYPASS_AUTH` mode for empty-state routes; (c) typecheck and unit tests. Module-specific tables
marked "not rendered" should be eyeballed with seeded data before release.
