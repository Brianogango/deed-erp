# Sales — page overrides

> Overrides `design-system/MASTER.md` for `/sales`.  
> Also mirrored at `design-system/deed-erp/pages/sales.md`.

**Mode:** Operate  
**Dials:** VARIANCE 2–3 · MOTION 2 · DENSITY 8  
**Pilot under review:** Phase 4 Directions A/B/C may replace the signature; until a direction is approved, the incumbent slate-ink + emerald pilot remains live.

## Incumbent signature (Direction A baseline)

1. Slate-ink command header (`--text-1`) with white title  
2. Emerald (`--success`) icon tile, tab underline, primary CTA, pipeline active state  
3. **One** pipeline strip: Draft quotes · Sent · Confirmed · Ready to invoice  
4. Do **not** also render OperationalSummary KPI cards for the same counts  
5. Kanban: top status bar (not left borders)

## Phase 3 rules (Sales-specific)

- Topbar must not duplicate an H1 “Sales” when ModuleHeader already titles the page — prefer section crumb only  
- Quotations vs Orders: empty Quotations should surface a clear switch CTA when Orders &gt; 0  
- Money/counts: `tabular-nums` + mono  
- Empty CTA: **New quotation**  
- Press feedback ~120ms; reduced-motion respected  
- No Inventory navy copy-paste; no purple

## Preserve (all directions)

- Flows, tab IDs (`quotations` / `orders`), filters, kanban columns  
- `SalesRecordHeader` stepper + permission gates  
- APIs / dual-write / seals
