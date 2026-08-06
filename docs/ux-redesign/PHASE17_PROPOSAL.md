# Deed ERP — UI/UX Audit & Redesign Proposal (Phase 17)

**Status:** Awaiting approval — **no application code changes in this deliverable**  
**Date:** 2026-08-06  
**Author:** Lead product design / ERP UX architecture pass  
**Environment inspected:** Local Next.js (`deed_erp_ci`) with authenticated director session — **not production**

Related prior artefact: uploaded `Deed_ERP_UI_UX_Audit_Proposal_2195.pdf` (Phase 17 draft; issue tables corrupted as `[object Object]` in PDF extraction). This document supersedes that draft with repository-verified findings and live UI inspection.

---

## 0. Skill verification

| Requested skill | Installed equivalent | Status |
|-----------------|----------------------|--------|
| redesign-existing-projects | — | **Not installed** — principles applied manually |
| impeccable | — | **Not installed** — visual inconsistency review performed manually |
| ui-ux-pro-max | `.claude/skills/ui-ux-pro-max` | **Available** — used for ERP density / UX / Next.js / anti-pattern research |
| frontend-design | — | **Not installed** — deferred until implementation |
| design-taste-frontend | — | **Not installed** — taste constraints applied from brief |
| emil-design-eng | — | **Not installed** — deferred |
| find-animation-opportunities | — | **Not installed** — motion deferred (Phase 19) |
| improve-animations | — | **Not installed** |
| review-animations | — | **Not installed** |

**Proceeding with `ui-ux-pro-max` + brief constraints + repository evidence.** Missing skills will not block the proposal; they should be installed before implementation review gates if required.

---

## 1. Frontend architecture summary

| Layer | Technology | Notes |
|-------|------------|-------|
| Framework | **Next.js 14.2.35** App Router | Pages are thin `dynamic(..., { ssr: false })` wrappers |
| UI | **React 18** | Client-heavy operational modules |
| Styling | **Tailwind 3.4.19** + `app/globals.css` (~3.8k+ lines) | CSS variables are the live token source |
| Component kit | **Custom** (`components/ui/index.tsx`) | `components.json` is shadcn-shaped; **no generated shadcn primitives** |
| ERP chrome | `components/erp/*` | `ModuleHeader`, `TablePageLayout`, `StatusBadge`, `RecordHeader`, … |
| Tables | Custom `components/data-table/*` | Not TanStack Table |
| Icons | **Font Awesome 7** via `components/icons.tsx` | `lucide-react` installed, **unused** |
| Forms | Hand-built `useState` + `Field`/`Input`/`Select` | No react-hook-form |
| Charts | Recharts 2.12.7 | Sales dashboard |
| State | Monolithic `lib/store.tsx` + Zustand slices + SWR | Dual blob (`localStorage`/`app_state`) + Prisma/API |
| Auth | NextAuth v4 JWT (`deed-session`) | Middleware + `hasModuleAccess` nav filter |
| Fonts | Self-hosted **Inter** + **DM Mono** | `app/fonts.ts` |
| Tests | Vitest (logic mirrors) + Playwright e2e (API-heavy) | Thin UI coverage |

**Shell:** `AppShell` mounts Sidebar + Topbar + `#main-content` once for authenticated sessions. Public routes (`/login`, `/portal/*`, `/track/*`) skip shell (except when `VISREG_BYPASS_AUTH` forces shell).

---

## 2. Current styling approach

- **Canonical tokens:** `app/globals.css` `:root` and `[data-theme='dark']`
- **Tailwind mirror:** `tailwind.config.js` (some hex duplicated vs CSS vars)
- **Docs:** `design-system/deed-erp/MASTER.md`, `docs/ERP_UI_SPEC.md`
- **Brand from assets:** `public/deed-logo.svg` → Navy `#1A1F5E`, Cyan `#00AEEF` (token `--accent-cyan` is `#00B0D7` — slight mismatch)
- **Primary action:** `#2563EB` (`--primary`)
- **Maturity:** Partial design system — tokens and chrome exist; **adoption is inconsistent** (~940 hex literals and ~1,650 `style={{…}}` in `components/`)

---

## 3. Existing component inventory (reusable)

### Shell / layout
`AppShell`, `Sidebar`, `Topbar`, `GlobalSearch`, `ThemeToggle`

### `components/ui`
Badge, ToneBadge, Toast, Modal, SlidePanel, Confirm, Field, Input, Textarea, Select, Table, RecordCard, PanelHeader, StatCard, SearchPicker, StatusStepper, StatePanel/Skeleton, TabBar, ModuleHeader, Pagination, EmptyState, FilterChip, SearchInput, ExportButtons, …

### `components/erp`
ModuleChrome, TablePageLayout, PageToolbar, PrimaryActionButton, SecondaryActionMenu, StatusBadge, RecordHeader, FormSection, FilterDrawer, OperationalSummary, Breadcrumbs, SmartButtons, PermissionDeniedState, …

### `components/data-table`
DataTable, DataTableToolbar, AdvancedFilters, ActiveFilterChips, BulkActionsBar, ColumnVisibilityMenu, DetailsDrawer, ExportMenu, MobileCardView, SavedViewsMenu, ViewSelector, …

**Preserve and extend these — do not invent a second design system.**

---

## 4. UI / UX audit (live inspection)

Screenshots: `docs/ux-redesign/screenshots/`

### Observed strengths
- Navy sidebar + light content is recognisably Deed (not purple SaaS)
- Shared ModuleHeader / TabBar / DataTable pattern on Operations, Sales, Repairs, Contacts, Finance
- Empty states and search/filter toolbars already exist on list pages
- Density control (“Cozy”), theme toggle, global ⌘K search, collapsible nav groups, pin favourites
- Repair list has clear status pills + left-edge status stripe

### Observed problems (evidence-based)

| # | Problem | Evidence |
|---|---------|----------|
| 1 | **Chrome stack too tall** | Topbar title + module header + tabs + filters before data (Ops/Sales/Finance) |
| 2 | **Topbar overcrowded** | JARVIS + Search + Cozy + Theme + Conflict + Date + Bell + Profile |
| 3 | **Dashboard KPI card wall** | Large `dashboard-stat-card`s; purple accent (`#8B5CF6`) reused for unrelated KPIs |
| 4 | **Inventory IA overload** | Catalog / Products / Warehouse / Movements / Stock take / Transfers / More |
| 5 | **Duplicate status systems** | `StatusBadge` vs Repair `STATUS_COLORS` vs Refurbishment/AfterSales/Kilimall/portal maps |
| 6 | **Hardcoded colours / inline styles** | ~940 hex matches; ~1,650 inline styles in components |
| 7 | **Login marketing aesthetic** | Glass card, glow, dot-grid — diverges from calm operational shell |
| 8 | **Mobile hierarchy noise** | Sync banner + hamburger header + tabs + actions before cards (Ops/Repairs mobile) |
| 9 | **Sync conflict UX** | Banner + red “Conflict (n)” button compete; functional (blob sync), not cosmetic |
| 10 | **Sales/Purchase inconsistency** | Sales uses TablePageLayout; Purchase tabs less standardised |
| 11 | **Emoji / symbol icons** | Portal/track status emoji; RepairIntake device emoji; notification glyphs |
| 12 | **Document title pollution** | Browser title set to `🚨 Action Required!` during notification state |

---

## 5. Accessibility audit

| Area | Finding |
|------|---------|
| Focus | Login focus ring visible; Field primitives support `aria-invalid` / `aria-describedby` |
| Skip link / shell | Present in AppShell patterns |
| Contrast | `--text-4` intentionally raised for AA; login footer / muted copy still at risk |
| Colour-only status | Status pills usually include text; left-edge stripes alone are insufficient without labels |
| Keyboard | Global search combobox has activedescendant; denser tables need audit in pilot |
| Touch | Icon buttons uneven; print/chevron on repair mobile cards look sub-44px |
| Reduced motion | Tokens `--motion-fast/base` exist; adoption incomplete |
| Semantic headings | Multiple competing “page titles” (Topbar + ModuleHeader) confuse hierarchy |
| Screen readers | Notification-driven `document.title` with emoji is hostile |

---

## 6. Responsive audit

| Breakpoint | Behaviour | Verdict |
|------------|-----------|---------|
| Desktop 1440 | Sidebar expanded; dense tables workable | Refine |
| Laptop 1280 | Similar; topbar crowding worse | Refine |
| Tablet 768 | Tables → cards/filters collapse | Mostly OK; header still busy |
| Mobile 390 | Drawer nav; MobileCardView / repair cards | Usable but chrome-heavy; action buttons crowd |

Breakpoints already defined: `sm 480 / md 768 / lg 1024 / xl 1280 / 2xl 1536` (+ max-* variants).

---

## 7. Main visual inconsistencies

1. ModuleHeader vs ModuleChrome vs custom headers (POS, Dashboard, Cashbook, portals)
2. Status colour sources (5+ maps)
3. Currency formatting (`fmtKes` vs ad-hoc `KSh`)
4. Card wrapping of tables on some modules, not others
5. Logo cyan `#00AEEF` vs token `#00B0D7`
6. Arbitrary `text-[Npx]` (~2,740) vs token typography scale
7. Login dark glass vs light operational pages

---

## 8. Generic / AI-adjacent patterns detected

| Pattern | Where | Action |
|---------|-------|--------|
| Purple KPI accents (`#8B5CF6`) | Dashboard | Replace with semantic status / navy / primary |
| Glassmorphism + glow | Login | Calm branded auth; no glow |
| Dot-grid decorative background | Login | Soften or remove |
| Large decorative KPI cards | Dashboard | Compact action-oriented summary |
| Pill overuse | Status everywhere | Keep for status only; not for every label |
| JARVIS prominence in topbar | Global | Keep capability; reduce visual weight in shell |

**Not observed as dominant:** purple-on-white marketing gradients across modules; glass on operational tables.

---

## 9. Screens requiring the most attention

| Priority | Screen | Why |
|----------|--------|-----|
| P0 | Application shell (Sidebar/Topbar) | Sets consistency for every module |
| P0 | Inventory `/operations` | Dense tables + IA + shared chrome testbed |
| P0 | Repairs list + detail | Status workflow clarity |
| P1 | Dashboard | Action orientation vs KPI wall |
| P1 | Portal + `/track` | Emoji/hex debt; customer-facing |
| P1 | Sales ↔ Purchase parity | Same commercial documents, different chrome |
| P2 | Login | Brand calmness |
| P2 | Contacts | Smaller surface; good second pilot (per uploaded PDF) |
| P2 | Ecommerce | Functionally incomplete (sample data) — document separately |

---

## 10. Proposed Deed ERP design direction

**Character:** Dependable · Precise · Calm · Dense · Brand-anchored · Operationally efficient

**Do:**
- Neutral page background (`--bg-page`), white primary surfaces, fine borders
- Deed Navy sidebar; primary blue only for primary actions / active / links / focus
- Cyan sparingly (group labels, brand accents) — not purple
- Compact readable density; tabular numerals for money/qty via DM Mono
- One primary action per viewport; overflow in SecondaryActionMenu

**Don’t:**
- Marketing heroes, glass dashboards, decorative charts, purple accent spam
- Cards around every table
- Rebuild the app or swap component libraries without approval

**Guiding principle (aligned with uploaded PDF):** Fix and adopt the existing system — don’t invent a second visual language.

---

## 11. Proposed design tokens (extend existing)

Keep `globals.css` as source of truth. Propose additions / consolidations only:

### Surfaces
| Token | Role |
|-------|------|
| `--bg-page` | App background |
| `--bg-card` | Primary surface |
| `--bg-surface` / `--bg-muted` | Secondary |
| `--sidebar-bg-from/to` | Sidebar |
| `--topbar-bg` | Header |

### Brand
| Token | Value | Use |
|-------|-------|-----|
| `--navy` | `#1A1F5E` | Sidebar, corporate |
| `--primary` | `#2563EB` | CTA / active / links |
| `--accent-cyan` | align to logo `#00AEEF` **or** keep `#00B0D7` (decision) | Accents |

### Status (single map)
| Meaning | Colour | Examples |
|---------|--------|----------|
| Success / done / paid / available | green | Completed, Paid |
| Pending / awaiting / low stock | amber | Pending, Low stock |
| Error / overdue / cancelled critical | red | Overdue, Failed |
| Active process / info | blue | In progress |
| Draft / archived / inactive | grey | Draft, Cancelled |

**Rule:** Text + optional icon; never colour alone. Consolidate into `StatusBadge` / `statusColor()`.

### Typography ladder (restrained)
Display 24 · Heading 18 · Subhead 15 · Body 14 · Caption 12 · Micro 11 · Nano 10 — mapped to existing `--fs-*` where possible. Prefer Inter; DM Mono for financial/serial/SKU.

### Spacing / radius / motion
Keep `--space-1…8`, tighten radius toward enterprise (`--radius-sm` for controls; avoid oversized pills). Motion 120–180ms feedback; 180–240ms drawers; no bounce; honour `prefers-reduced-motion`.

---

## 12. Proposed navigation structure

Keep current groups (already close to brief):

1. **Overview** — Dashboard, Contacts  
2. **Sales Channels** — Sales, CRM, POS, E-commerce, Kilimall  
3. **Stock & Fulfilment** — Operations, Purchases, Delivery  
4. **Service Operations** — Repairs, Refurbishment, Reconfiguration, Outsource, After-Sales, Holdovers  
5. **Finance & People** — Finance, Deposits, Expenses, HR, Documents, KPI Targets, SOPs  
6. **Administration** — Settings (director)

**Shell refinements (visual only):**
- Stronger active state; clearer collapsed tooltips (already partly present)
- Reduce topbar chrome weight (Conflict → compact icon; date optional on laptop+)
- Preserve role-based `hasModuleAccess` filtering — **no permission changes**

---

## 13. Proposed table system

Extend `DataTable` + `TablePageLayout` as the standard:

Sticky header · sort · search · advanced filters · chips · column visibility · density · selection/bulk · export · skeleton · empty · error · keyboard · numeric right-align · monetary/date formatters · StatusBadge · primary row action + overflow menu · mobile: priority columns + expandable details (prefer controlled scroll over giant cards)

---

## 14. Proposed form system

Extend `Field` / `Input` / `Select` / `FormSection`:

Visible labels · required markers · consistent heights · section grouping · searchable selects · currency/qty inputs · inline validation · sticky actions on long forms · unsaved warning where drafts exist · 2-col desktop / 1-col mobile  

**Do not** introduce react-hook-form in the pilot unless approved (decision).

---

## 15. Proposed status system

One canonical map in `StatusBadge` covering sales, purchase, repair, finance, inventory states. Modules must not define local hex maps. Repair workflow stages remain **existing system names** — visual clarity only.

---

## 16. Recommended pilot module

### Recommendation: **Inventory / Operations (`/operations`)**

**Why (matches Phase 16 option B):**
- Best representation of current frontend architecture (ModuleHeader + TabBar + TablePageLayout + DataTable)
- Dense tables, filters, empty states, multi-tab IA, product forms
- Highest leverage for propagating table/form/token standards
- Live screenshot evidence of chrome height, tab overflow, empty states

**Pilot scope must include:** shell polish + page header + search/filters + table + status + empty/loading/error + detail/drawer + form + confirm + responsive.

### Strong alternative: **Repairs** (Phase 16 option A)
Choose if status workflow + technician workbench is the strategic priority. Higher complexity (multiple status dialects, detail view, intake).

### Lower-risk alternative: **Contacts** (uploaded PDF)
Good for bug-fix + token adoption with smaller blast radius — **less representative** of dense ERP tables. Acceptable as Phase A warm-up before Inventory.

**Decision required:** Approve Inventory pilot, Repair pilot, or Contacts warm-up → Inventory.

---

## 17. Files expected to change (after approval)

| Area | Likely files |
|------|----------------|
| Tokens | `app/globals.css`, `tailwind.config.js`, `design-system/deed-erp/MASTER.md` |
| Shell | `components/layout/Sidebar.tsx`, `Topbar.tsx`, `AppShell.tsx` |
| Foundations | `components/ui/index.tsx`, `components/erp/*`, `components/data-table/*` |
| Pilot Inventory | `components/modules/Inventory.tsx`, `components/inventory/*` |
| Optional Repair | `components/modules/Repair*.tsx`, `repair-config.ts`, `RepairDetailView.tsx` |
| Tests | `__tests__/table-*.test.ts`, Playwright smoke for pilot routes |

**Out of scope for pilot:** Prisma schemas, APIs, permissions, accounting/inventory calculations, portal rewrite (document only).

---

## 18. Risks

| Risk | Mitigation |
|------|------------|
| Visual churn across mega-modules | Pilot first; token adoption module-by-module |
| Blob sync conflicts confuse UX review | Document as functional defect; do not “design away” without data fix |
| Giant `store.tsx` regressions | UI-only changes; no store logic edits in visual commits |
| Status consolidation breaks meaning | Map 1:1 to existing status keys; no rename |
| Radius/density shift feels “wrong” to daily users | Keep density toggle; default compact for ops roles if approved |
| Screenshot CI noise | Use existing `screenshots:core` baselines |

---

## 19. Assumptions

1. Brand colours from `deed-logo.svg` + existing navy/primary tokens are authoritative.
2. Business logic, permissions, routes, and document numbering stay frozen.
3. Existing `DataTable` / `ModuleHeader` / `StatusBadge` are the extension points.
4. Light mode remains the default product experience; dark mode stays opt-in.
5. Local CI DB emptiness is acceptable for empty-state audit; production data not used.
6. Uploaded PDF Contacts bugs (payment terms default, loyalty `0`, delete affordance) are **functional** and tracked separately from visual work.

---

## 20. Decisions requiring approval

1. **Pilot module:** Inventory (recommended) vs Repair vs Contacts warm-up  
2. **Cyan token:** Align `--accent-cyan` to logo `#00AEEF`?  
3. **Form library:** Stay hand-built vs approve react-hook-form later  
4. **Topbar:** Reduce JARVIS / date / conflict visual weight?  
5. **Dashboard:** Compact action queue vs keep large KPI cards  
6. **Inventory IA:** Collapse 11 tabs into fewer primary groups? (IA change needs product OK; no logic change)  
7. **Login:** Soften glass/glow toward operational calm?  
8. **Radius:** Slightly tighter enterprise radius than current `--radius-lg`?  
9. **Install missing design skills** before implementation review gates?  

---

## Functional defects (separate from visual redesign)

Do **not** silently change behaviour while redesigning:

| ID | Defect | Notes |
|----|--------|-------|
| F-01 | Sync conflict / stale blob overwrite | Banner on Contacts/Sales/Finance during local session |
| F-02 | Document title `🚨 Action Required!` | Notification side-effect |
| F-03 | Ecommerce sample/hardcoded orders | Functionally incomplete |
| F-04 | Contacts payment-terms default / loyalty `0` / delete (PDF) | Functional; separate commits |
| F-05 | Product ID blob↔Prisma mismatch (ARCH-001) | Already caused GRN failure; not UI |
| F-06 | Catalog search flicker / optimistic update issues | Document if reproduced; no silent logic change |

---

## Current screenshots

| # | Screen | File |
|---|--------|------|
| 1 | Login | `screenshots/01-login-desktop.png` |
| 2 | Dashboard | `screenshots/02-dashboard-desktop.png` |
| 3 | Operations catalog | `screenshots/03-operations-desktop.png` |
| 4 | Operations mobile | `screenshots/04-operations-mobile.png` |
| 5 | Repairs list | `screenshots/05-repairs-desktop.png` |
| 6 | Repairs mobile | `screenshots/06-repairs-mobile.png` |
| 7 | Contacts | `screenshots/07-contacts-desktop.png` |
| 8 | Sales | `screenshots/08-sales-desktop.png` |
| 9 | Finance invoices | `screenshots/09-finance-desktop.png` |

---

## Implementation plan (post-approval only)

1. Consolidate / document tokens in `design-system/deed-erp/MASTER.md`  
2. Harden foundational components (StatusBadge, ModuleHeader, DataTable density)  
3. Shell refinements  
4. Pilot module (Inventory recommended)  
5. Verify workflows unchanged; responsive + keyboard checks  
6. Before/after screenshots  
7. Impeccable / taste review (install skills if approved)  
8. Present pilot before rolling to Sales → Repairs → Finance → remaining modules  

**Motion (Phase 19)** only after layout stable: sidebar, drawer, modal, toast — no table animation, no bouncing totals.

---

## Acceptance criteria (pilot)

- Existing workflows still work; no business logic / permission / API contract changes  
- One consistent token language on shell + pilot  
- Tables scannable; forms structured; statuses unambiguous  
- Desktop / tablet / mobile OK; keyboard OK  
- Loading / empty / error present  
- No new generic AI styling; motion minimal  
- Before/after screenshots + relevant tests  
- Remaining issues documented  

---

**End of Phase 17 proposal — awaiting review and approval before any application code edits.**
