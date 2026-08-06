# Implementation plan

## Phase A — Prototypes (this branch)
1. Isolated `/sales-prototype/*` routes + demo data  
2. Seven core screens + list  
3. Screenshots (1440 / 1366 / 1024 / 390)  
4. Discrepancy + a11y report  
5. **Stop for approval** — no production integration  

## Phase B — Production (after approval)
1. Map prototype components onto `components/modules/Sales.tsx` / shared `erp/*`  
2. Preserve `odoo-sales-flow` transitions; extend statuses carefully  
3. Wire confirm dialog (reserve / no-reserve) with server enforcement  
4. Picking UX enhancements on existing DeliveryNoteView  
5. Invoice modes without silent accounting changes  
6. Tests for state transitions + visual regression  

## Non-goals for Phase A
- Schema changes  
- Production store writes  
- Permission / accounting / inventory logic changes  
