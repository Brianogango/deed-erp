# Inventory / Operations — page overrides

> Overrides `design-system/deed-erp/MASTER.md` for `/operations` (Inventory pilot).

**Mode:** Operate (Impeccable) — scanability and density over expression.  
**Do not** apply marketing redesign patterns from `design-taste-frontend` / landing-page guidance.

## Visible pilot chrome (must remain obvious)

1. Navy left edge on module header + filled navy icon tile
2. Inventory overview rail (4 clickable stats) under tabs
3. Catalog operational summary as metric chips (clickable stock filters)
4. Warehouse board: 3 columns on wide desktop
5. Navy active tabs (not bright blue pills with glow)
6. Stronger table header case + row hover using primary-light

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

## Motion

Stat press: `scale(0.98)` ~120ms. Hover border only. No table animation.
