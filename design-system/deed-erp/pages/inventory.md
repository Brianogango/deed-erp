# Inventory / Operations — page overrides

> Overrides `design-system/deed-erp/MASTER.md` for `/operations` (Inventory pilot).

**Mode:** Operate (Impeccable) — scanability and density over expression.  
**Pass:** `/impeccable bolder` on Inventory chrome only (Amplify navy the system already owns).  
**Do not** apply marketing redesign patterns from `design-taste-frontend` / landing-page guidance.

**Design read:** Enterprise ERP Inventory Operate surface for warehouse staff — data-dense navy command chrome, not a landing page.  
**Dials (taste skill restraint):** VARIANCE 3 · MOTION 2 · DENSITY 8.

## Visible pilot chrome (must remain obvious in one glance)

1. **Solid navy command header** (inverted: white title/actions on navy gradient) — not a thin left edge
2. **Navy tab strip** with cyan active underline
3. **Connected overview strip** (4 clickable cells: label + mono value) under tabs
4. Catalog operational summary as metric chips (clickable stock filters)
5. Warehouse board: 3 columns on wide desktop
6. Navy-tinted table headers / toolbar / page wash under the command band

## Preserve

- Existing ModuleHeader → TabBar → TablePageLayout / DataTable chrome
- All inventory calculations, serial tracking, permissions, and API contracts
- Tab IDs and route behaviour (`MAIN_TABS` / URL aliases)

## Visual rules

1. Use CSS tokens (`--navy`, `--navy-dark`, `--accent-cyan`, `--primary`, semantic status) — no purple hex accents.
2. Warehouse section chrome uses tone variants (`navy` / `warning` / `info`), not inline hex.
3. Refurbishment job status uses shared `StatusBadge` / canonical `statusColor` map.
4. Quantities and money use `tabular-nums` (+ mono where already used for serials/SKU).
5. Empty catalog with no filters shows a primary **New product** CTA when the user can edit stock.
6. Header primary CTA is white-on-navy; secondary actions are ghost white borders.

## Motion

Stat press: `scale(0.99)` ~120ms. Cyan underline on active tab/stat. Respect `prefers-reduced-motion`. No table animation.
