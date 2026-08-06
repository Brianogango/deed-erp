# Sales — page overrides

> Overrides `design-system/MASTER.md` for `/sales`.  
> Mirrored at `design-system/deed-erp/pages/sales.md`.

**Mode:** Operate  
**Approved direction:** **B — Deed navy + cyan** (2026-08-06)  
**Dials:** VARIANCE 2–3 · MOTION 2 · DENSITY 8

## Signature

1. **Navy command header** (`--navy` / `--navy-dark`) with white title  
2. **Cyan** (`--accent-cyan`) icon tile, tab underline, primary CTA, pipeline active rail  
3. **One** pipeline strip only (no OperationalSummary duplicate KPIs)  
4. Topbar crumb: `Selling · Sales` (no second subtitle competing with ModuleHeader)  
5. Table: navy-tint headers; cyan row hover  
6. Kanban: top status bar; sale column = cyan (success reserved for money/paid states)  
7. Refs may use `--primary` blue in table cells  

## Preserve

- Quotation / order / delivery / invoice flows and API contracts  
- Tab IDs (`quotations` / `orders`), list filters, kanban columns  
- `SalesRecordHeader` stepper + permission gates  

## Rules

1. Tokens only — no purple, no slate-ink emerald chrome (legacy Direction A retired)  
2. Emerald (`--success`) only for success/money semantic states, not module chrome  
3. Empty Quotations with existing Orders → CTA to switch to Orders  
4. Press ~120ms; `prefers-reduced-motion` respected  
5. Header CTA press `scale(0.97)`; action menu quiet (`rounded-lg` / `shadow-md`)  
6. Delivery status fallback chips use `text-gray-700` (not `600`) on `bg-gray-50`  
7. Quote create + record detail: navy action/form header, cyan primary CTAs, quiet panels, navy totals (no violet smart chips)  
