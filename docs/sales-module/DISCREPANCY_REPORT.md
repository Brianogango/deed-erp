# Sales Module prototype — visual & QA discrepancy report

**Date:** 2026-08-06  
**Branch:** `cursor/sales-module-prototypes-ddc8`  
**Reference:** Supplied 8-panel Sales workflow collage  
**Screenshots:** `docs/sales-module/screenshots/` (7 pages × 4 viewports = 28 PNGs)

## Verdict

Prototypes are **ready for review**. Layout density, navy shell, blue primary CTAs, tabs-above-tables, status pills, totals panels, and related-document links match the reference collage. Actions are demo-only (toast). **Do not integrate into production until approved.**

## Visual comparison vs reference

| Criterion | Match | Notes |
|-----------|-------|-------|
| Compact enterprise density | High | 12–13px UI, thin borders, white panels |
| Light-grey page + white surfaces | High | `--sp-bg` / `--sp-surface` |
| Navy left sidebar | High | Deed navy gradient |
| Primary blue top-right CTAs | High | `#2563EB` Submit / Create delivery / Mark as delivered / Record payment |
| Status pills by ref | High | Draft grey, Sent blue, Accepted/Confirmed green, Shortage amber |
| Tabs above content | High | Underline active |
| Totals summary | High | Right-aligned; sticky on create quote |
| Workflow bar (SO) | High | Horizontal Confirmed→Paid |
| Serial picking layout | Medium–High | Lines + scan + selected; not full 3 equal panes on narrow laptop |
| Success banners | High | Green acceptance / confirm messaging |
| Cross-doc blue links | High | Quote ↔ SO ↔ Delivery ↔ Invoice |
| Purple accent | N/A | Reference uses blue CTAs; purple removed from prototype chrome |
| Marketing / glass / heroes | Pass | None |

### Remaining deltas (acceptable for Phase A)

1. **Sidebar IA** — Prototype lists the 7 screens for review navigation; reference shows Quotes / Sales Orders / Deliveries / Invoices as product IA. Production integration should map into existing ERP sidebar, not keep this review nav.
2. **Document numbers** — Demo uses `SQ/` / `SO/` / `DN/` / `INV/` Deed sequences vs collage `QUO-` / `DEL-` labels.
3. **Confirm panel** — Confirm is a modal on quotation detail rather than a dedicated “Confirm Quote” page panel (collage panel 3).
4. **Goods delivered** — Delivered success state is represented on the picking page (status + toast), not a separate read-only delivered screen.
5. **Invoice paid end-state** — Invoice prototype shows partially paid + payments tab (collage panel 8 shows Paid / balance 0). Easy follow-up.
6. **Table column crowding on mobile** — Horizontal scroll on line tables; expandable rows not yet implemented.
7. **Optional Products / Terms / History tabs** — Placeholders with copy, not full editors.

## Responsive checks

| Viewport | Result |
|----------|--------|
| 1440×1024 | Pass — sidebar + multi-column forms |
| 1366×768 | Pass — dense but usable |
| 1024×768 | Pass — sidebar collapses to top nav strip |
| 390×844 | Pass — stacked fields; primary actions wrap; no critical horizontal page overflow on create quote |

## Accessibility checks

| Check | Result |
|-------|--------|
| Skip link to `#sales-proto-main` | Present |
| `main` landmark | Present |
| Page `h1` | Present on all 7 screens |
| Tablist / tab roles | Present |
| Workflow `role=list` + `aria-current` | Present |
| Proto actions announce via `role=status` toast | Present |
| Colour-only status | Mitigated — pills include text labels |
| Focus on primary buttons | Keyboard focusable |
| Contrast (body on white) | Pass (≥4.5:1 intent with `#111827` on `#fff`) |
| Contrast (sidebar muted labels) | Acceptable for decorative nav labels; active item uses white on blue |

## Interaction checks

| Action | Expected | Observed |
|--------|----------|----------|
| Primary button click | Toast: prototype only | Toast shown; no store/API write |
| Serial scan invalid | Toast | Toast |
| Serial duplicate | Toast | Toast |
| Confirm dialog open | Modal with reserve options | Present on quotation detail |
| Tab switching | Content swap | Works |
| Related document links | Client navigation between prototype routes | Works |

## Screenshot index

```
docs/sales-module/screenshots/
  01-quotations-list/{desktop-1440,laptop-1366,tablet-1024,mobile-390}.png
  02-create-quotation/...
  03-quotation-detail/...
  04-sales-order/...
  05-delivery-picking/...
  06-invoice-create/...
  07-invoice-payment/...
```

## Approval ask

Please review the screenshots and this report. On approval, Phase B can begin integrating patterns into production `/sales` **without** changing inventory/accounting/permission logic silently.
