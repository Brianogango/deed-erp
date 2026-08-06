# Sales — page overrides

> Overrides `design-system/deed-erp/MASTER.md` for `/sales`.

**Mode:** Operate (Impeccable) — scanability and pipeline density over expression.  
**Skills:** impeccable Operate + craft-floor · frontend-design · redesign-existing-projects · design-taste restraint · ui-ux-pro-max Trust & Authority / data-dense.

**Design read:** B2B ERP Sales Operate for sales ops — slate-ink command chrome with emerald money accents. Distinct from Inventory’s navy + cyan band.  
**Dials:** VARIANCE 3 · MOTION 2 · DENSITY 8.

## Signature (must be obvious in one glance)

1. **Slate-ink command header** (`--text-1` / near-black gradient) with white title
2. **Emerald** (`--success`) icon tile, active tab underline, primary CTA, pipeline active rail
3. **Pipeline strip** under tabs: Draft quotes · Sent · Confirmed orders · Ready to invoice (clickable filters)
4. Slate-tinted table headers / toolbar; emerald row hover
5. Kanban cards use a **top status bar** (not thick left borders — craft-floor)

## Preserve

- Quotation / order / delivery / invoice flows and API contracts
- Tab IDs (`quotations` / `orders`), list filters, kanban columns
- `SalesRecordHeader` stepper behaviour

## Visual rules

1. Tokens only: `--text-1`, `--success`, `--warning`, `--primary` — no purple, no Inventory navy copy-paste.
2. Money and counts: `tabular-nums` + mono where already used for data.
3. Empty list CTA remains **New quotation**.
4. Press feedback only (~120ms). Respect `prefers-reduced-motion`.
