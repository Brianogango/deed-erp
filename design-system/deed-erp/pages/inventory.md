# Inventory / Operations — page overrides

> Overrides `design-system/deed-erp/MASTER.md` for `/operations` (Inventory pilot).

**Mode:** Operate (Impeccable) — scanability and density over expression.  
**Do not** apply marketing redesign patterns from `design-taste-frontend` / landing-page guidance.

## Preserve

- Existing ModuleHeader → TabBar → TablePageLayout / DataTable chrome
- All inventory calculations, serial tracking, permissions, and API contracts
- Tab IDs and route behaviour (`MAIN_TABS` / URL aliases)

## Visual rules

1. Use CSS tokens (`--navy`, `--primary`, `--info-*`, `--warning-*`, `--success-*`, `--danger-*`) — no purple hex accents.
2. Warehouse section chrome uses tone variants (`navy` / `warning` / `info`), not inline hex.
3. Refurbishment job status uses shared `StatusBadge` / canonical `statusColor` map.
4. Quantities and money use `tabular-nums` (+ mono where already used for serials/SKU).
5. Empty catalog with no filters shows a primary **New product** CTA when the user can edit stock.
6. Cards only for interactive warehouse sections — not decorative wrappers around every table.

## Motion

None required for pilot beyond existing 150–180ms hover/opacity. No table animation.
