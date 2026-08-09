# Reconfiguration — page overrides

> Overrides `design-system/MASTER.md` for `/reconfiguration`.  
> Mirrored intent of Inventory Operate pilot.

**Mode:** Operate  
**Dials:** VARIANCE 3 · MOTION 2 · DENSITY 8

## Signature

1. Solid navy command header (reuse `inventory-pilot` chrome)  
2. Cyan active tab underline  
3. **One** overview rail (Open / Approval / On bench / Completed)  
4. Workbench detail: pipeline stepper, action tray, current vs proposed, remove/install queues  
5. Create flow as a 3-step wizard (Device → Target → Review)

## Preserve

API routes, permissions, status machine, reservation / QA / complete actions, Sales deep-link `?id=`.

## Rules

Tokens: `--navy`, `--accent-cyan`, status semantics — no purple.  
Press ~120ms. No table row animation beyond hover.  
Mono (`tabular-nums`) for serials, costs, GB figures.
