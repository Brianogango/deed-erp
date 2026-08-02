# Responsive Tables — Full-Proof Plan

Status: **Phases A–C implemented** on `cursor/responsive-tables-37a6`.

## Problem

Tables overflow, overlap, and force horizontal page scroll because three systems fight each other:

1. **DataTable** (`components/data-table/`) — cards below **768px**, but desktop grids forced `minWidth={960}`
2. **CSS card-stack** (`.responsive-table` / `.erp-responsive-table`) — only activated at **≤640px**
3. **Legacy modules** — hard `min-w-[600|700|800px]` wrappers that expand past the viewport; AppShell patch ran only on route timers (missed tab/panel DOM updates)

The **641–767px gap** was the main bug: JS already treated that range as mobile, CSS still rendered wide desktop tables.

## Rules (permanent)

| Case | Pattern |
|------|---------|
| Module list / CRUD tables | `DataTable` → `MobileCardView` &lt;768; column priority on tablet+ |
| Legacy HTML `<table>` | Auto `.erp-responsive-table` card stack &lt;768 |
| Legacy grid `.table-head`/`.table-row` | `.table-scroll.responsive-table` card stack &lt;768 |
| Form line editors / ledgers / reports | Intentional `.dt-scroll` (scroll stays inside wrapper) |
| Opt-out | `data-no-responsive` on `<table>` |

Never put a hard `min-w-[Npx]` wrapper around a list table without a bounded `overflow-x-auto`/`dt-scroll` parent that also has `min-w-0 max-w-full`. Prefer removing the min-width and using card stack.

## Phase A — Foundation (done)

- [x] Unify CSS table card-stack breakpoint **640 → 767** (match `useTableBreakpoint`)
- [x] DataTable: compute `minWidth` from visible columns (no hard 960)
- [x] Contain scroll: `min-w-0 max-w-full` on `.table-scroll`, `.dt-scroll`, `.mod-page`, `.mod-body`, `.view-enter`
- [x] Kill nested `min-w-*` wrappers under overflow containers at &lt;768
- [x] AppShell: `MutationObserver` + debounce so late-rendered tables get labels
- [x] Hot-fix TradeIn / Contacts history / SOPs hard min-width wrappers

## Phase B — Hot modules (done)

- [x] TradeIn buy-back / donation / exchange lists → `DataTable`
- [x] Sales order detail / new-order / delivery line tables → `.dt-scroll` + `data-no-responsive`
- [x] Contacts import preview → `.dt-scroll`
- [x] AfterSales RMA lines → stacked flex (no hard min-width)
- [x] Kilimall settlement line editor → `.dt-scroll`
- [x] InvoiceDetail / Deposits / CRM ClientDetail / PivotView / Repair parts → `.dt-scroll`

## Phase C — Form & report discipline (done)

- [x] Form/report tables use `.dt-scroll` with `data-no-responsive` (scroll stays inside wrapper)
- [x] Page/module wrappers keep `min-w-0 max-w-full` so flex children cannot blow the viewport

## Phase D — Retirement (later)

- Finish remaining hand-rolled list tables still on the AppShell adapter
- Remove AppShell `applyLegacyResponsiveTables` once unused
- Optional: column pinning for wide desktop reports

## Acceptance checklist

Test at **375 / 768 / 1024 / 1440**:

- [ ] No horizontal **page** scroll on list modules
- [ ] Phone: cards with labels + Details toggle (not clipped columns)
- [ ] Tablet: DataTable cards or priority-capped columns; scroll only inside `.table-scroll`/`.dt-scroll`
- [ ] Desktop: full grid; resize/column prefs still work
- [ ] Form line tables: contained horizontal scroll only
- [ ] `prefers-reduced-motion` respected; touch targets ≥44px on mobile actions
