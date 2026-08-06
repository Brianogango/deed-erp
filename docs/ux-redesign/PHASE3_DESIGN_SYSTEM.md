# Phase 3 — Design Intelligence

**Date:** 2026-08-06  
**Skill:** ui-ux-pro-max (`search.py --design-system` + domain supplements)  
**Code changes:** None (design docs / tokens documentation only)

## Queries run

1. Enterprise ERP inventory sales repair finance operational dashboard dense tables approval workflows → design system  
2. UX: dense data table filter search accessibility  
3. Color: enterprise SaaS professional trust  
4. Style: minimal professional enterprise  
5. Typography: professional readable sans data UI  
6. Chart: KPI bar line financial status  
7. Stack: react (a11y forms) + nextjs  
8. UX: animation reduced motion  

Raw notes: `/tmp/promax-*.md` (session)

## Adopted

- **Style family:** Data-Dense Dashboard + Minimal/Swiss restraint + Trust (navy/grey integrity)  
- **Primary color:** keep Deed `#2563EB` / navy `#1A1F5E` / cyan `#00B0D7`  
- **Density / a11y / reduced-motion** guidelines  
- **Charts:** bar/line; avoid pie &gt;5 slices; no digit-roll animation  

## Rejected / adapted

| Suggestion | Why |
|------------|-----|
| Enterprise Gateway landing pattern | Marketing; not Operate ERP |
| Amber CTA `#F59E0B` | Conflicts with Deed; use primary/success |
| Fira Code / Fira Sans | Would replace self-hosted Inter + DM Mono |
| Chart zoom / heavy filter motion | Violates MOTION dial 2 |
| Indigo Micro-SaaS palette | Purple bias banned |

## Persisted

| Path | Role |
|------|------|
| `design-system/MASTER.md` | Global SoT |
| `design-system/pages/sales.md` | Sales override |
| `design-system/pages/inventory.md` | Inventory override |
| `design-system/deed-erp/MASTER.md` | Pointer to canonical |

## Chrome contract (new)

1. One command header — no dual H1 with topbar  
2. One pipeline/summary strip — no duplicate KPI cards  
3. Shared components only  
4. Motion ≤ 220ms; never tables/money  

## Stop → Phase 4

Visual directions A/B/C next; no implementation until a direction is approved.
