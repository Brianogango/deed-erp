# Sales — page overrides

> Overrides `design-system/MASTER.md` for `/sales`.  
> Mirrored at `design-system/deed-erp/pages/sales.md`.

**Mode:** Operate  
**Approved direction:** **Odoo grammar + Deed navy / cyan** (2026-08-23)  
**Dials:** VARIANCE 2–3 · MOTION 2 · DENSITY 8

## Signature

1. **Odoo control panel** — light breadcrumb `Sales / Quotations`, navy **New**  
2. **Search view** — search + Filters / Group By, no KPI card rail  
3. **Navy** primary actions and current statusbar pill  
4. **Cyan** links, active notebook underline, selected row  
5. Form sheet + statusbar + chatter grammar (chatter is the target; list/form chrome ships first)  
6. Kanban: top status bar; success reserved for money/paid states  
7. Confirm quotation opens reserve / no-reserve dialog (permissions gated)  
8. Delivery picking shows progress summary + serial scan field  

## Preserve

- Quotation / order / delivery / invoice flows and API contracts  
- Tab IDs (`quotations` / `orders`), list filters, kanban columns  
- `SalesRecordHeader` stepper + permission gates  
- Inventory/accounting rules — UI never bypasses server checks  

## Rules

1. Tokens only — no purple, no slate-ink emerald chrome. Primary CTAs are navy; cyan is links / selection / active underline only  
2. Emerald (`--success`) only for success/money semantic states, not module chrome  
3. Empty Quotations with existing Orders → CTA to switch to Orders  
4. Press ~120ms; `prefers-reduced-motion` respected  
5. Header CTA press `scale(0.97)`; action menu quiet (`rounded-lg` / `shadow-md`)  
6. Delivery status fallback chips use `text-gray-700` (not `600`) on `bg-gray-50`  
