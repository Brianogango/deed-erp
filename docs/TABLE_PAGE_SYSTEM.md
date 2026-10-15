# Table page design system

## Structure

```
ModuleHeader + primary action
TabBar (≤6 + More)
TablePageLayout
  title + OperationalSummary (inline text)
  CompactInfoNotice (optional)
  DataTable surface
    DataTableToolbar (search · filters · More filters | Columns · Export · ⋯)
    ActiveFilterChips (when active)
    Table / MobileCardView
    Pagination
```

## Master table system (single source of truth)

Geometry and type live in **tokens** (`app/globals.css`, `:root`) and are applied by **one layer**
(`components/erp/horizon-table-alignment.css`). Module CSS may recolour; it must not redeclare heights,
padding or header type.

| Token | Value | Meaning |
|---|---|---|
| `--table-row-height` | 48px | body row |
| `--table-head-height` | 40px | header and page-total row |
| `--table-pad-x` | 12px | row/cell side padding |
| `--table-col-gap` | 12px | grid column gap |
| `--table-head-fs` | ≥11px | header type: sentence case, 600, secondary ink |

| Pattern | Use | Class / component |
|---|---|---|
| Standard / transaction / financial grid | every list | `DataTable` → ui `Table` (`.table-scroll.responsive-table`) |
| Raw HTML table (reports, editable lines, admin tools) | anything not a list | `<table className="erp-table">` (alias `.data-table`) |
| Mobile record view | `<768px` container | `MobileCardView` → `RecordCard` |
| Status | any badge in a table | `Badge` / `StatusBadge` (compact variant applied inside tables) |

Legacy named tables (`.sp-table`, `.invoice-detail__table`, `.reconfig-table`, `.contacts-compact-table`,
`.accounting-dashboard__table`) are selectors of the same raw-table rules, not separate systems.

### Alignment rules
Text and dates left · money and quantities right with tabular numerals (`align: 'right'` on the column) ·
selection checkbox centred · actions right. Headers follow their column.

## Column width policy

- Declared widths are **proportions**, not ceilings. `118px` and `2fr` columns both grow with the card and share
  slack in proportion to their declared width (`components/ui` grid builder). A flexible column can no longer
  swallow all free space.
- `fixed` columns (selection checkbox, row actions) never grow.
- Every column has a floor (default 80px; status ≥140px; right-aligned figures ≥88px). Override with `minWidth`.
- Floors are capped at 10rem so a name column can always yield.
- **Progressive disclosure** (`lib/data-table/fit.ts`): when the user has not chosen columns, the default set is
  trimmed to what fits the container — priority-3 columns yield first, then priority-2, never priority-1.
  Dropped columns stay available in the column picker. Do not set `minTableWidth` to force scroll.
- Cell text uses ellipsis + `title` / `TruncatedText`.
- Tables scroll horizontally inside `.table-scroll` only when priority-1 floors do not fit; the page never scrolls.

## Reference pages

1. Accounting invoices — Partner/Date overlap fix
2. Inventory Catalog — KPI cards → compact summary + notice
3. Sales list — ops summary as text, not filter chips

## Rollback

Revert the feature branch; no schema migrations.
