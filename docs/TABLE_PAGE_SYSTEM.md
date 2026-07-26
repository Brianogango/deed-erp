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

## Column width policy

- Fixed `Npx` tracks stay fixed (never `minmax(Npx, 1fr)`).
- `Nfr` tracks become `minmax(~7N rem, Nfr)`.
- Prefer `minmax(14rem, 2fr)` for partner/product/customer names.
- Cell text uses ellipsis + `title` / `TruncatedText`.
- Tables scroll horizontally inside `.table-scroll` when needed; page itself must not overflow.

## Reference pages

1. Accounting invoices — Partner/Date overlap fix
2. Inventory Catalog — KPI cards → compact summary + notice
3. Sales list — ops summary as text, not filter chips

## Rollback

Revert the feature branch; no schema migrations.
