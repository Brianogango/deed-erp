# Quote create + record detail restyle (Direction B)

**Date:** 2026-08-06  
**Branch:** `cursor/sales-quote-views-ddc8`  
**Prerequisite:** Direction B list chrome merged to `master`

## Surfaces

| Surface | Classes |
|---------|---------|
| New quotation | `.sales-quote-form` + `.sales-quote-form-header` |
| Record detail | `.sales-quote-detail` + `.sales-quote-detail-actions` |
| Panels / lines / totals | `.sales-quote-panel`, `.sales-quote-lines`, `.sales-quote-summary`, `.sales-quote-total` |

## Changes

- Navy action/form headers with cyan primary CTAs (matches module chrome)
- Quieter panels (`0.5rem` radius, navy-tint borders, no card stack)
- Line table headers match list DataTable treatment
- Totals use navy mono tabular nums (not generic primary blue)
- Links use navy/cyan mix (not purple)
- `SalesRecordHeader`: Quotations vs Orders crumb; invoice smart chip uses primary (not violet)
- Stepper completed pills → navy inside Sales detail

## Non-goals

- Delivery note view (separate pass)
- Login glassmorphism
- Flow/API changes
