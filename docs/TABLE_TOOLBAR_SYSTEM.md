# Shared Table Toolbar System — Audit & Plan

## Audit summary

### Existing shared pieces
| Piece | Location | Gap vs target |
|---|---|---|
| `DataTableToolbar` | `components/data-table/DataTableToolbar.tsx` | Narrow search, separate PDF/Excel, always-on Views/Columns, no primary filters / chips / overflow / responsive More |
| `PageToolbar` | `components/erp/PageToolbar.tsx` | Layout shell only; modules still hand-roll controls |
| `FilterDrawer` | `components/erp/FilterDrawer.tsx` | Modal-based; usable for More filters |
| `AdvancedFilters` | `components/data-table/AdvancedFilters.tsx` | Column rule builder — keep as advanced panel content |
| `ExportButtons` | `components/ui` | Two first-level buttons (PDF + Excel) |
| `SearchInput` | `components/ui` | No clear affordance; width left to callers |
| `ColumnVisibilityMenu` / `SavedViewsMenu` | data-table | Keep; relocate in layout |

### Noise patterns found
1. **Dual toolbars** — modules render `module-filter-strip` / `PageToolbar` / status pills, then `DataTable` with `hideSearch` still shows Filters / Views / Columns / PDF / Excel.
2. **Status pill rows** — Expenses review, Outsource jobs (and similar).
3. **Separate PDF/Excel** — `ExportButtons` + AfterSales / Settings / HRSettings / Accounting report actions.
4. **Views always visible** — Saved-views menu on every DataTable even when only one layout exists.
5. **Inconsistent search** — bespoke `<input>` / `SearchInput` / PanelHeader controls; placeholders often vague.

### Tables in scope (~70 DataTable call sites)
Sales, SalesDashboard, Accounting (+ journals/ledgers/COA/partner), Inventory (many tabs), Repairs (RepairClientJobs), Outsource, Expenses, Delivery, Deposits, Holdovers, Refurbishment, AfterSales, CRM, Contacts, Cashbook, Kilimall, Purchase tabs, HR tabs, Leave, POS, Ecommerce, Settings/HRSettings, RepPerformance, Trade-in lists where DataTable is used.

Out of scope (unchanged): print/PDF document tables, editable line editors, SOP pivots.

---

## Implementation plan

### Phase 1 — Shared system
- Add toolbar types + CSS tokens (`.dt-toolbar*`).
- Build: `ExportMenu`, `ActiveFilterChips`, `FilterSelect`, `MoreFiltersButton` + drawer, `TableOverflowMenu`, enhanced `SearchInput` (clear).
- Rewrite `DataTableToolbar` as the single layout engine (alias export `TableToolbar`).
- Extend `DataTable` with controlled search, primary/advanced filters, chips, layout views, overflow, export menu, responsive column/overflow rules.
- Saved views move into overflow; layout Views only when `layoutViews` provided.

### Phase 2 — Example tables
- Outsource jobs (status + vendor).
- Expenses review (status + staff).

### Phase 3 — Module sweep
- Replace external filter strips with DataTable toolbar config (or standalone `TableToolbar` + `hideToolbar` where needed).
- Inventory Catalog first + catalog/products toolbars.
- Sales list: status/context in toolbar; keep table/kanban as layout Views.
- RepairClientJobs, Inventory tabs, AfterSales, Delivery, Deposits, Accounting strips, Kilimall, HR/Purchase, etc.

### Phase 4 — Cleanup
- Retire duplicate PDF/Excel first-level buttons via `ExportMenu`.
- Remove permanent status-pill groups and empty secondary rows.
- Update `docs/ERP_UX_REFACTOR.md`.

### Phase 5 — Verify
- Unit tests for toolbar behaviour.
- `npm test`, lint/typecheck via build, `npm run build`.

### State / a11y / permissions
- Preserve module filter state (local/URL as today); reset page on filter change inside DataTable.
- Export continues to use filtered rows; permission gating stays at module + API.
- Aria-labels, Escape/focus for menus/drawers, 40px desktop / ≥44px touch targets.

### Rollback
- Revert the feature branch / PR; no schema migrations.
