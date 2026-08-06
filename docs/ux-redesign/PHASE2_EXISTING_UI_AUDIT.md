# Phase 2 — Existing UI Audit

**Date:** 2026-08-06  
**Scope:** Audit only — **no application code changed**  
**Skills:** Impeccable (`critique` Assessment A + `detect.mjs`) · design-taste-frontend (Operate restraint / anti-slop)  
**Mode:** Operate (ERP), not Persuade/marketing  
**Assessment B note:** Detector CLI ran on layout + Dashboard + Sales + Inventory + `components/ui`. Full browser overlay injection was not required for this docs phase; live screenshots from prior pilots remain available under `/opt/cursor/artifacts/`.

---

## Executive verdict

The ERP already has a **real design system** (tokens, shared chrome, DataTable, StatusBadge) and two **strong Operate pilots** (Inventory navy; Sales slate + emerald). Overall specificity is **partial**: pilots feel like Deed; most other modules still read as generic dense admin UI with local colour dialects.

**Heuristic score (Assessment A):** **26/40 — Acceptable**  
**Biggest risks if we “just restyle”:** uneven pilots, IA tab walls, dual titles, purple status residue, a11y gaps in shell chrome.

---

## Surfaces reviewed

| Area | Sources |
|------|---------|
| Sidebar / Topbar | `components/layout/Sidebar.tsx`, `Topbar.tsx`, `GlobalSearch.tsx` |
| Dashboard | `components/modules/Dashboard.tsx` |
| Sales / Inventory pilots | `Sales.tsx`, `Inventory.tsx`, `.sales-pilot` / `.inventory-pilot` CSS |
| Repair / Refurb | `RepairClientJobs.tsx`, `Refurbishment.tsx` (critique) |
| Shared UI | `components/ui/index.tsx`, `components/erp/*` |
| Tokens / docs | `app/globals.css`, `design-system/deed-erp/*`, `docs/ERP_*.md` |

---

## What is working (preserve)

1. **Token foundation** in `globals.css` (brand navy/blue/cyan, status pairs, spacing, motion, z-index).
2. **Shared Operate primitives:** ModuleHeader, TabBar (keyboard + overflow portal), TablePageLayout, DataTable, OperationalSummary, PrimaryActionButton, StatusBadge, PermissionDeniedState, EmptyState, ModuleSkeleton.
3. **Inventory & Sales pilots** — inverted command bands, clickable rails, mono tabular metrics, page overrides.
4. **Power-user shell** — pins + Alt shortcuts, Ctrl+K search, table density, role-gated nav.
5. **Documented UX rules** — one primary action, ≤6 tabs + More, no KPI card strips on lists (`docs/ERP_UX_REFACTOR.md`).
6. **Responsive intent** — off-canvas sidebar, stacked tables, 44px targets in many controls, reduced-motion hooks.

---

## Audit findings by category

### Generic / AI-adjacent patterns (Taste + detector)

| Finding | Evidence | Severity |
|---------|----------|----------|
| Thick **side-tab** borders | `border-l-4` Inventory; `borderLeft: 4px` RecordCard/StatCard; Repair left status rails | High |
| Bounce / elastic easing | GlobalSearch + ui Confirm/Modal curves `cubic-bezier(0.34, 1.2/1.4, …)` | Medium |
| Gray text on tinted fills | Sales `text-gray-600` on `bg-blue-50`; Inventory slate on indigo | Medium |
| Dashboard decorative orbs / soft hero greeting | Dashboard hero styling | Medium |
| Emoji as UI | Sidebar pin ★/☆; Topbar urgent 🚨; Refurb ✅ | Medium |
| Large uniform `rounded-2xl` cards | `.card`, RecordCard, empty states | Low–Med |
| Module purple accents | Refurb `#8B5CF6` / violet Tailwind; banned by MASTER | High |

### Hierarchy & chrome consistency

| Finding | Detail |
|---------|--------|
| **Dual titles** | Topbar route `h1` + ModuleHeader title (pilots amplify the second) |
| **Uneven pilots** | Sales/Inventory command bands vs white compact Repair/Refurb/others |
| **Crowded Topbar** | Search, Density, Theme, JARVIS, Bell, Account, date/sync compete |
| **Inventory tab wall** | ~9–11 peer tabs → More buries critical stock actions |

### Tables, filters, density

| Finding | Detail |
|---------|--------|
| System exists | DataTable + toolbar + chips + mobile cards — good |
| Density uneven | Some modules still custom tables / card grids |
| Ops summaries | Correct direction; pilots restyle as chips — watch for KPI-card regression |
| Row actions | Some &lt;44px (`w-7 h-7`) with `title` only |

### Forms, detail, modals, drawers

| Finding | Detail |
|---------|--------|
| Shared Modal / SlidePanel / Confirm | Present; bounce easing on some entrances |
| RecordHeader / SmartButtons / steppers | Good for Sales detail |
| Repair detail | Dense secondary panels (noted in ERP_UX_REFACTOR follow-ups) |
| FilterDrawer | Exists; adoption incomplete |

### Status & approvals

| Finding | Detail |
|---------|--------|
| Canonical StatusBadge | Exists and should be universal |
| Fragmented maps | Repair/Refurb local colour maps + left borders |
| Approvals | Functionally present; chrome does not always make pending state globally scannable |

### Accessibility

| Finding | Detail |
|---------|--------|
| Strengths | Focus-visible global; many aria-labels; tab roles; inert mobile sidebar |
| Gaps | Some icon controls `title`-only; notification rows as clickable `div`s; Toggle without name; colour-only status in places; collapsed sidebar hover-only tooltips |
| Contrast | `--text-4` improved for AA; gray-on-color detector hits remain |

### Responsive / mobile

| Finding | Detail |
|---------|--------|
| Sidebar drawer | Solid pattern &lt;768 |
| Tables | Stacking + horizontal scroll patterns exist |
| Risk | Topbar wrap + dense filters on phone; inconsistent touch targets on row actions |

### Loading / empty / error / permission

| State | Assessment |
|-------|------------|
| Loading | ModuleSkeleton / table skeletons — good baseline |
| Empty | EmptyState + CTA patterns — generally good; copy quality varies |
| Error | Toasts + field errors — uneven near-field placement |
| Permission | PermissionDeniedState — preserve |

### Hard-coded styling

- Pilot CSS hard-codes `#0b1220`, `#12163f`, `#fff` (acceptable if later tokenised)
- Module hex accents (`#8B5CF6`, Tailwind violet/rose) — replace with tokens
- README still mentions Lucide/DM Sans / dark-only in places — docs drift

---

## Impeccable detector snapshot (CLI)

Run against layout + Dashboard + Sales + Inventory + `components/ui`:

| Antipattern | Count (sample) | Files |
|-------------|----------------|-------|
| `side-tab` | 5+ | Inventory, ui RecordCard/StatCard |
| `bounce-easing` | 4+ | GlobalSearch, ui modal/confirm |
| `gray-on-color` | 2+ | Sales, Inventory |

---

## Screens / areas that should **not** change lightly

1. **Auth / password-change** flows and security UX copy  
2. **Customer portal / track** public surfaces (separate identity)  
3. **Posted finance document** behaviours (immutability) — visual only around them  
4. **PermissionDeniedState** semantics  
5. **DataTable DOM contracts** (`data-label`, density attrs)  
6. **Role-gated nav ModuleIds / hrefs**  
7. **Business steppers** that encode real status machines (Sales, Repair) — restyle, don’t reorder steps without product sign-off  

---

## Priority backlog (for later phases — do not implement yet)

### P0 — Design system decision (Phase 3–4)
Unify **one Operate chrome language** (command band vs compact) with module accent tokens — stop navy/slate/white fragmentation.

### P1 — Consistency
1. Extend chosen chrome to Repair (recommended pilot for Phase 5)  
2. Remove purple / side-tab status dialects → StatusBadge + top accent only  
3. Resolve dual Topbar/ModuleHeader title ownership  
4. Distill Inventory IA (tabs vs hubs)  

### P2 — Quality
5. Replace bounce easings; tokenise gray-on-color  
6. Shell a11y (notification rows, unlabeled toggles, 44px row actions)  
7. Dashboard Operate quieting (orbs/eyebrow)  
8. Sweep emoji icons → Font Awesome  

### P3 — Motion (Phase 7 only)
Drawer/modal/toast only; never large tables or money ticks.

---

## Taste-skill design read (Operate)

> Reading this as: **enterprise ERP Operate UI** for Deed staff, with a **trust-first / data-dense** language, leaning toward **tokenised navy–blue–cyan brand + restrained motion** — not a landing page, not glassmorphism, not consumer SaaS marketing.

**Dials for future work:** VARIANCE **2–3** · MOTION **2** · DENSITY **8–9**

---

## Stop here

Phases **1–2 complete**.  
**Do not start Phase 3** (design-system regeneration), **4** (directions), **5** (prototypes), or code migration until:

1. This audit is reviewed  
2. `prototype` skill is installed for Phase 5  
3. Explicit approval to continue  

---

## Artefact index

| Artefact | Path |
|----------|------|
| Product context | `PRODUCT.md` |
| Incumbent design scan | `DESIGN.md` |
| Phase 1 summary | `docs/ux-redesign/PHASE1_PRODUCT_DESIGN_CONTEXT.md` |
| Phase 2 audit (this file) | `docs/ux-redesign/PHASE2_EXISTING_UI_AUDIT.md` |
| Prior pilots | `design-system/deed-erp/pages/inventory.md`, `sales.md` |
