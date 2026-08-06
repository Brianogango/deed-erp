# Phase 1 — Product & Design Context (redo)

**Date:** 2026-08-06 (revision 2)  
**Skills:** Impeccable `init` + `document` (scan)  
**Code changes:** none  
**Substitution:** PRODUCT.md facts from redesign brief + repository (`lib/auth/*`, user guides, shell). Open decisions labelled.

---

## Skill gate

| # | Skill | Status |
|---|--------|--------|
| 1 | impeccable | OK — `.cursor/skills/impeccable` |
| 2 | frontend-design | OK |
| 3 | design-taste-frontend | OK (Operate restraint only) |
| 4 | ui-ux-pro-max | OK |
| 5 | emil-design-eng | OK (Phase 7) |
| 6 | prototype | **MISSING** — blocks Phase 5 |
| 7–10 | review / improve / find-animation / pick-ui-library | OK |

---

## Design read (Taste, adapted for ERP)

> Reading this as: **redesign of an enterprise Operate ERP** for Deed staff, with a **trust-first / calm / data-dense** language, leaning toward **Deed navy–blue–cyan tokens + shared custom UI kit** — not a marketing site, not glassmorphism SaaS.

**Dials for all later phases:** `DESIGN_VARIANCE: 2` · `MOTION_INTENSITY: 2` · `VISUAL_DENSITY: 8`

---

## Artefacts (authoritative)

| File | Role |
|------|------|
| [`PRODUCT.md`](../../PRODUCT.md) | Users, workflows, constraints, brand, principles |
| [`DESIGN.md`](../../DESIGN.md) | Incumbent visual system + known fractures |
| Live tokens | `app/globals.css` |
| Module rules | `design-system/deed-erp/MASTER.md` (+ inventory/sales pages) |

**Path note:** Phase 3 brief mentions `design-system/MASTER.md`. Incumbent path is `design-system/deed-erp/MASTER.md`. Recommend keeping the folder and adding a pointer in Phase 3 — not done here.

---

## Capture checklist

| Topic | Result |
|-------|--------|
| Intended users | 8 staff roles + self-service; portal/track separate |
| Main workflows | Sales, Inventory, Repairs, Finance (see PRODUCT.md) |
| Brand | Navy / blue / cyan; logo in `public/`; Operate feel adjectives binding |
| Frontend architecture | Next 14 App Router, Tailwind, Context store + SWR, custom ui/erp/data-table |
| Component library | `components/ui`, `components/erp`, `components/data-table`, layout shell |
| Constraints | APIs, Prisma/blob, permissions, business machines, routes, DOM contracts |
| Must preserve | Listed in PRODUCT.md |
| A11y / responsive | AA target, 44px, reduced-motion, off-canvas sidebar, stacked tables |
| Inconsistencies | Uneven pilots, purple repair accents, dual titles — full list in Phase 2 |

---

## Desired product feel (binding)

Dependable · Professional · Precise · Modern · Calm · Operationally efficient · Enterprise-ready · Aligned with Deed Technologies.
