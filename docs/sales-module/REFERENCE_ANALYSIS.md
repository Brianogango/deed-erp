# Sales Module — reference analysis

**Date:** 2026-08-06  
**Status:** High-fidelity prototypes  
**Reference:** Supplied Sales Module workflow collage (8 panels: Draft Quote → Invoice & Payment)

## Extracted visual system

| Element | Reference observation | Prototype rule |
|---------|----------------------|----------------|
| Application shell | Permanent left nav, icon + label | Deed navy sidebar 220px |
| Page background | Light grey canvas | `--sp-bg` `#F4F5F7` |
| Content surfaces | White panels, thin borders | `--sp-surface` + `--sp-border` |
| Primary actions | Solid blue top-right buttons | `--sp-accent` `#2563EB` (Deed primary) |
| Secondary actions | White / bordered buttons | `.sp-btn` default |
| Status pills | Yellow draft, green confirmed/paid/delivered | `.sp-pill-*` tones |
| Success banners | Soft green alert after confirm/deliver | `.sp-banner-ok` |
| Tabs | Under content header, above tables | `.sp-tabs` underline active |
| Tables | Dense line-item grids | 12px, compact row height |
| Totals | Bottom-right summary | `.sp-totals` / sticky on create |
| Cross-links | Blue text to related docs | `.sp-linkish` |
| Typography | Compact sans, clear hierarchy | 13px UI / 18px titles |
| Shadows | Minimal | `0 1px 2px` only |
| Forbidden | Heroes, glass, heavy gradients, oversized cards | Enforced in CSS scope |

## Workflow panels mapped to routes

| # | Reference panel | Prototype route |
|---|-----------------|-----------------|
| 1 | Draft Quote / Create Quote | `/sales-prototype/quotations/new` |
| 2 | Save Quote / Quote Details | `/sales-prototype/quotations/quo-001` |
| 3 | Confirm Quote | Same detail + confirm dialog + green banner |
| 4 | Sales Order | `/sales-prototype/orders/so-001` |
| 5 | Delivery & Picking (serials) | `/sales-prototype/deliveries/dn-001` |
| 6 | Goods Delivered | Delivery page status + success banner (demo) |
| 7 | Convert to Invoice | `/sales-prototype/invoices/new` |
| 8 | Invoice & Payment | `/sales-prototype/invoices/inv-001` |
| — | Quotations list (extra) | `/sales-prototype/quotations` |

## Brand decision

Reference CTAs are **blue**, not purple. Prototypes use Deed `--primary` `#2563EB` with navy shell (`#1A1F5E`) — matches both the supplied collage and existing ERP brand.
