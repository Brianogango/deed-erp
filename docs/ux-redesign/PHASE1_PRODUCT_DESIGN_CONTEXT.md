# Phase 1 — Product and Design Context

**Date:** 2026-08-06  
**Scope:** Docs only — no application code changed  
**Skills:** Impeccable `init` + `document` (scan)  
**Substitution note:** Impeccable prefers a live product interview. This run inferred PRODUCT.md from the redesign brief + repository evidence (`lib/auth/*`, `docs/*`, `Sidebar.tsx`, `globals.css`) and labelled open decisions explicitly.

---

## Skill gate (pre-flight)

| # | Skill | Accessible? | Path |
|---|--------|-------------|------|
| 1 | impeccable | **Yes** | `.cursor/skills/impeccable/SKILL.md` |
| 2 | frontend-design | **Yes** | `.cursor/skills/frontend-design/SKILL.md` |
| 3 | design-taste-frontend | **Yes** | `.cursor/skills/design-taste-frontend/SKILL.md` |
| 4 | ui-ux-pro-max | **Yes** | `.cursor/skills/ui-ux-pro-max/SKILL.md` |
| 5 | emil-design-eng | **Yes** | `.cursor/skills/emil-design-eng/SKILL.md` |
| 6 | prototype | **No** | Not installed (intentionally skipped at prior install; present upstream in `emilkowalski/skills`) |
| 7 | review-animations | **Yes** | `.cursor/skills/review-animations/SKILL.md` |
| 8 | improve-animations | **Yes** | `.cursor/skills/improve-animations/SKILL.md` |
| 9 | find-animation-opportunities | **Yes** | `.cursor/skills/find-animation-opportunities/SKILL.md` |
| 10 | pick-ui-library | **Yes** | `.cursor/skills/pick-ui-library/SKILL.md` |

**Phase 5 blocker:** `prototype` must be installed (project-local) before parallel worktree prototypes.

---

## Durable artefacts created

| File | Purpose |
|------|---------|
| `PRODUCT.md` | Impeccable product truth (users, workflows, constraints, brand) |
| `DESIGN.md` | Incumbent visual system scan (tokens + Operate rules) |

Existing authorities retained (not replaced):

- `app/globals.css` — live token SoT
- `design-system/deed-erp/MASTER.md` — project design rules (+ inventory/sales page overrides)
- `docs/DESIGN_SYSTEM.md`, `docs/ERP_UI_SPEC.md`, `docs/ERP_UX_REFACTOR.md`, `docs/TABLE_PAGE_SYSTEM.md`

**Note for Phase 3:** Brief asks for `design-system/MASTER.md`; incumbent path is `design-system/deed-erp/MASTER.md`. Recommend keeping the deed-erp folder and optionally adding a pointer file later — not done in Phase 1.

---

## Capture summary

### Intended users
Eight staff roles (director → technician) plus self-service HR/expenses/docs for all authenticated users. Primary context: dense desktop/tablet Operate work.

### Main operational workflows
Sales (quote→invoice), Inventory (PO→GRN→warehouse), Repairs (intake→collect), Finance (invoices/bills/cashbook).

### Deed brand characteristics
Navy `#1A1F5E`, blue `#2563EB`, cyan `#00B0D7`; logo assets in `public/`; calm enterprise Operate tone.

### Constraints / must preserve
APIs, Prisma + blob parity, permissions, business seals, routes/ModuleIds, table DOM contracts, Next/Tailwind stack, shared `components/ui` + `components/erp`.

### Accessibility / responsive (incumbent)
WCAG AA intent; `--text-4` contrast fix documented; 44px targets; `prefers-reduced-motion`; sidebar off-canvas &lt;768; responsive table stacking.

### Current design inconsistencies (preview — full list in Phase 2)
Uneven module pilots (Inventory/Sales vs default white chrome); purple accents in Repair/Refurb; dual Topbar+ModuleHeader titles; status map fragmentation; large radius / card noise; detector findings (side-tab borders, bounce easing, gray-on-color).

### Desired product feel (from brief)
Dependable · Professional · Precise · Modern · Calm · Operationally efficient · Enterprise-ready · Aligned with Deed Technologies.
