# Phase 1 — Product & Design Context

**Date:** 2026-08-06  
**Branch:** `cursor/ux-sales-phase1-2-ddc8`  
**Skills used:** Impeccable (`init` + `document` + Operate), design-taste-frontend (dial inference only)  
**Code changes:** None

## Skill gate (this session)

| # | Skill | Status |
|---|-------|--------|
| 1 | impeccable | Available — `.cursor/skills/impeccable` |
| 2 | frontend-design | Available |
| 3 | design-taste-frontend | Available |
| 4 | ui-ux-pro-max | Available |
| 5 | emil-design-eng | Available |
| 6 | **prototype** | **MISSING** — blocks Phase 5 only |
| 7 | review-animations | Available |
| 8 | improve-animations | Available |
| 9 | find-animation-opportunities | Available |
| 10 | pick-ui-library | Available |

Phases 1–4, 6–8 can proceed with available skills. **Install `prototype` before Phase 5.**

## Design read (Taste)

Reading this as: **Operate-mode B2B ERP redesign** for Deed operators, with a **calm enterprise** language, leaning toward **token-driven Tailwind + shared ERP chrome**, dials **VARIANCE 2 / MOTION 2 / DENSITY 8**.

## Captured artefacts

| File | Role |
|------|------|
| `PRODUCT.md` | Durable product truth (inferred; labelled) |
| `DESIGN.md` | Incumbent visual system scan |
| `design-system/deed-erp/MASTER.md` | Existing global rules (unchanged) |
| `design-system/deed-erp/pages/sales.md` | Sales pilot overrides (unchanged) |

## Intended users

Director, sales_rep, finance_officer, admin_officer, inventory_officer, technical_lead, technician, kilimall_officer — see `PRODUCT.md` / `role_access_design.md`.

## Main operational workflows

Sales pipeline, inventory/serials, repairs, finance AR/AP — see `PRODUCT.md`.

## Deed brand characteristics

- Primary blue `#2563EB`, navy `#1A1F5E`, cyan `#00B0D7`
- Professional / precise / calm — not consumer or “AI purple”
- Sales pilot currently expresses brand via **slate-ink + emerald money accent** (distinct from Inventory navy)

## Constraints to preserve

- Routes, permissions, APIs, dual-write blobs
- Shared chrome components and responsive table DOM contracts
- Accessibility baseline (`docs/ERP_UI_SPEC.md`)
- Existing Sales / Inventory pilot page overrides until Phase 4 chooses a direction

## Responsive behaviour (incumbent)

- Sidebar → drawer &lt;768px
- Tables → card/stack patterns via `.erp-responsive-table` / DataTable mobile view
- Sales pipeline rail: 2→4 columns
- Modals full-width on phone
- Touch targets 44px for icon actions

## Accessibility requirements (incumbent)

- Skip link, focus-visible, aria-labels on icon buttons
- Contrast-safe status tokens
- Reduced motion → near-instant transitions
- Visible field labels

## Current design inconsistencies (preview → Phase 2)

- Module pilots (Sales / Inventory) diverge while peer modules still use generic chrome
- Dashboard / Inventory still carry purple/indigo hardcodes (`#8B5CF6`, indigo serial panels)
- Dual title patterns / card overuse in older modules
- Sales is relatively strong; shell + peers uneven

## Stop

Phase 1 complete. No application code modified. Proceeding to Phase 2 audit only.
