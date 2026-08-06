# Implementation plan

## Phase A — Prototypes (this branch)
1. Isolated `/sales-prototype/*` routes + demo data  
2. Seven core screens + list  
3. Screenshots (1440 / 1366 / 1024 / 390)  
4. Discrepancy + a11y report  
5. **Stop for approval** — no production integration  

## Phase B — Production (after approval) — IN PROGRESS on `cursor/sales-module-implement-ddc8`
1. Map prototype patterns onto production `/sales` (`.sales-pilot` + `Sales.tsx`)  
2. Preserve `odoo-sales-flow` transitions; no silent schema/accounting changes  
3. Wire confirm dialog (reserve / no-reserve) — UI gated; `confirmSO` / `prepareDelivery` authoritative  
4. Picking UX: progress summary + serial scan on `DeliveryNoteView`  
5. Invoice create/payment remain in Finance module (prototype routes kept for reference)  
6. Unit tests for confirm permission helpers + shortage detection  

## Non-goals for Phase A
- Schema changes  
- Production store writes  
- Permission / accounting / inventory logic changes  

## Non-goals for Phase B (this pass)
- New invoice UI inside `/sales` (still `/finance`)  
- Changing stock reservation rules beyond existing prepare path  
- Retiring `/sales-prototype` review routes (kept public for comparison) 
