# Phase 2 — Existing UI Audit (redo)

**Date:** 2026-08-06 (revision 2)  
**Scope:** Audit only — **no application code changed**  
**Skills:** Impeccable (critique Assessment A + `detect.mjs` Assessment B) · design-taste-frontend (Operate dials) · redesign-existing-projects (checklist adapted for ERP)  
**Mode:** Operate  

**Design read:** Enterprise Operate ERP for Deed staff — trust-first, calm, data-dense (VARIANCE 2 / MOTION 2 / DENSITY 8).

---

## Executive verdict

| Dimension | Score (0–4) | Notes |
|-----------|-------------|--------|
| Accessibility | **2** | Focus rings & many labels exist; title-only icons, clickable `div`s, colour-only status, some &lt;44px actions |
| Performance (UI) | **3** | Skeletons present; bounce easings & heavy blur overlays are minor |
| Theming / tokens | **2** | Strong token file; frequent hard-coded hex/Tailwind + purple dialects |
| Responsive | **3** | Sidebar drawer + table stacking exist; topbar/filter crowding on phone |
| Implementation integrity | **2** | Detector: 14 warnings + large advisory token drift; pilots diverge from default chrome |
| **Heuristic total (A)** | **26/40** | Acceptable — not ship-quality consistency |

**One-line:** Shared system is real; **two pilots look like Deed; peers still look like generic admin + local colour hacks.** Do not paint every module with another one-off band before Phase 4 chooses one language.

---

## Method

1. **Assessment A** — design-director review of shell, Dashboard, Sales, Inventory, Repair, Refurb, shared UI (prior run retained; findings re-validated in source).  
2. **Assessment B** — Impeccable detector on layout + Dashboard + Sales + Inventory + Repair + Refurb + `components/ui/index.tsx` → **482 findings**.  
3. **Taste / redesign** — anti-slop checklist with **ERP exclusions** (see below).  
4. **Live screenshots** — `/opt/cursor/artifacts/ux-phase2-redo/` (desktop, director session).

| Screen | File | Visual note |
|--------|------|-------------|
| Dashboard | `dashboard.png` | White content + card KPI tiles; navy sidebar; soft marketing-like greeting area |
| Sales | `sales.png` | Slate-ink command header + emerald CTA; pipeline strip; dense table empty state |
| Operations | `operations.png` | Navy command header + cyan accents; overview rail; Catalog table |
| Repairs | `repairs.png` | Default white compact header; colour status pills; left-accent rows — not on pilot chrome |
| Finance | `finance.png` | Default white compact header; multi-tab accounting; blue primary CTA |

**Chrome consistency (from screenshots):** Sales/Inventory = inverted command bands; Repairs/Finance/Dashboard content = default light chrome — confirms uneven rollout.

### Detector summary (Assessment B)

| Antipattern | Count | Severity |
|-------------|------:|----------|
| `design-system-font-size` | 331 | advisory (Tailwind arbitrary sizes vs DESIGN.md ramp) |
| `design-system-color` | 137 | advisory (undocumented colours vs DESIGN.md) |
| `side-tab` | 8 | warning |
| `bounce-easing` | 4 | warning |
| `gray-on-color` | 2 | warning |
| **Total** | **482** | 468 advisory / 14 warning |

Heaviest files: Inventory (127), Dashboard (82), Sales (73), Refurbishment (72), ui/index (44).

Advisory token drift is expected until Phase 3 regenerates MASTER + DESIGN.md as one SoT; **warnings are the actionable slop**.

---

## Surfaces reviewed

| Surface | What we looked for |
|---------|-------------------|
| Sidebar | Brand, groups, active state, pins, emoji, glow |
| Topbar | Dual title, utility density, a11y of icon controls |
| Dashboard | Hero/orbs, KPI cards, hierarchy vs Operate |
| Sales / Inventory | Pilot command bands, rails, table chrome |
| Repairs | Compact header, left status borders, purple in `STATUS_COLORS` |
| Refurbishment | `#8B5CF6` header, left borders, local STATUS_META |
| Tables / filters | Density, toolbar, empty/loading |
| Forms / modals / drawers | Shared Modal/SlidePanel; bounce easing |
| Status / approvals | StatusBadge vs local maps |
| Mobile | Drawer, stacked tables, touch targets |
| States | Skeleton, empty, toast/error, PermissionDenied |

---

## What works (do not throw away)

1. Token architecture in `globals.css` (brand, status pairs, spacing, motion, z-index, sidebar).  
2. Shared Operate kit: ModuleHeader, TabBar, TablePageLayout, DataTable, OperationalSummary, PrimaryActionButton, StatusBadge, EmptyState, ModuleSkeleton, PermissionDeniedState.  
3. Sales + Inventory pilots as **proof** that a stronger Operate chrome is possible.  
4. Power-user affordances: pins, Alt shortcuts, Ctrl+K, density toggle.  
5. Documented contracts in `docs/ERP_UX_REFACTOR.md` / table system docs.  
6. Light-first theme with opt-in dark.

---

## Findings by brief category

### Generic AI / Taste patterns (ERP-relevant)

| Finding | Where | Sev |
|---------|-------|-----|
| Side-tab / thick left status borders | Inventory `border-l-4`, ui RecordCard/StatCard, Repair/Refurb `borderLeft` | P1 |
| Purple / violet / pink status hexes | `repair-config.ts` (`#8B5CF6`, `#EC4899`), Refurb header `#8B5CF6` | P1 |
| Bounce/elastic easing | GlobalSearch, Modal/Confirm | P2 |
| Gray-on-color | Sales / Inventory tinted panels | P2 |
| Dashboard decorative orbs + soft greeting hero | Dashboard | P2 |
| Emoji as UI | Sidebar pins ★/☆, Topbar 🚨, Refurb ✅ | P2 |
| Uniform large `rounded-2xl` | Cards, empty states, search panel | P2 |

### Taste / redesign items **excluded** for Operate ERP

Do **not** treat these marketing recommendations as defects:

- Replace Inter with a “characterful” display font  
- Add grain/photo heroes or asymmetric marketing grids  
- Break sidebar IA into experimental top-nav for novelty  
- Maximise whitespace / art-gallery density  

### Hierarchy & chrome

| Finding | Sev |
|---------|-----|
| Dual Topbar `h1` + ModuleHeader title (pilots amplify) | P1 |
| Uneven pilots (navy / slate / white / purple) across modules | P1 |
| Crowded Topbar utility strip | P1 |
| Inventory ~9–11 peer tabs → “More” buries stock actions | P1 |

### Tables, filters, search

| Finding | Sev |
|---------|-----|
| DataTable system strong; adoption uneven | P2 |
| Some row actions &lt;44px + `title`-only | P2 |
| Ops summaries good; risk of regressing to KPI card strips | P2 |

### Forms, detail, modals, drawers

| Finding | Sev |
|---------|-----|
| Shared Modal/SlidePanel OK; bounce easing | P2 |
| Repair detail still dense secondary panels | P2 |
| FilterDrawer under-adopted | P3 |

### Status & approvals

| Finding | Sev |
|---------|-----|
| Canonical StatusBadge exists but not universal | P1 |
| Colour-only status (left bars, violet pills) | P1 |

### Accessibility

| Finding | Sev |
|---------|-----|
| Notification rows as clickable `div`s | P1 |
| Some toggles/icon buttons missing accessible names | P1 |
| Collapsed sidebar tooltips hover-only | P2 |
| `--text-4` improved for AA; gray-on-color remains | P2 |

### Responsive

| Finding | Sev |
|---------|-----|
| Sidebar off-canvas solid | — |
| Topbar + filters wrap poorly on narrow widths | P2 |
| Touch target inconsistency on dense rows | P2 |

### Loading / empty / error / permission

| State | Verdict |
|-------|---------|
| Loading | ModuleSkeleton / table skeletons — keep |
| Empty | EmptyState + CTA — keep; polish copy later |
| Error | Toasts + some field errors — uneven |
| Permission | PermissionDeniedState — keep |

### Hard-coded styling

- Module purple hexes and Tailwind violet/rose chips  
- Pilot hard-coded `#0b1220` / `#fff` (tokenise in Phase 3)  
- Arbitrary `text-[10px]` etc. → detector advisories  

---

## Screens that should not change lightly

1. Login / password-change security flows  
2. Customer portal & public track  
3. Posted finance document behaviour (visual shell only)  
4. PermissionDenied semantics  
5. DataTable DOM contracts  
6. Nav ModuleIds / hrefs / Sales & Inventory tab IDs  
7. Status stepper **order** tied to real machines (restyle only with product sign-off)

---

## Priority backlog (later phases — no code now)

### P0 — Direction (Phase 3–4)
Choose **one** Operate chrome language + module accent tokens. Stop adding one-off bands.

### P1
1. Unify Repair/Refurb (and peers) to chosen chrome; remove purple  
2. Replace side-tab status with StatusBadge (+ optional top hairline)  
3. Resolve Topbar vs ModuleHeader title ownership; thin Topbar utilities  
4. Distill Inventory IA (≤4 hubs) if product agrees  

### P2
5. Fix bounce easings + gray-on-color  
6. Shell a11y (names, notification rows, 44px actions)  
7. Quiet Dashboard Operate tone (drop orbs/eyebrow)  
8. Emoji → Font Awesome  

### P3 — Motion (Phase 7 only)
Drawer/modal/toast; never tables or money ticks.

---

## Comparison to prior Phase 2 draft

| Item | v1 | v2 (this redo) |
|------|----|----------------|
| Detector scope | Narrow sample | 482 findings across shell + 5 modules + ui |
| Audit scores | Heuristic only | + Impeccable 5-dimension scores |
| Taste dials | Mentioned | Locked 2 / 2 / 8 with ERP exclusions |
| Purple evidence | Mentioned | Concrete paths (`repair-config`, Refurb header) |
| Marketing false-positives | Implicit | Explicitly excluded |

---

## Stop

Phases **1–2 redo complete**. Await approval before Phase 3. Install **`prototype`** before Phase 5.

---

## Artefact index

| Artefact | Path |
|----------|------|
| Product | `PRODUCT.md` |
| Design scan | `DESIGN.md` |
| Phase 1 | `docs/ux-redesign/PHASE1_PRODUCT_DESIGN_CONTEXT.md` |
| Phase 2 | `docs/ux-redesign/PHASE2_EXISTING_UI_AUDIT.md` |
| Screenshots | `/opt/cursor/artifacts/ux-phase2-redo/` (when present) |
| PR | branch `cursor/ux-phase1-2-audit-ddc8` |
