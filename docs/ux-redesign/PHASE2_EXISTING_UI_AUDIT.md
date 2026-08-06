# Phase 2 — Existing UI Audit

**Date:** 2026-08-06  
**Focus:** ERP shell + **Sales module** (requested restyle target)  
**Skills:** Impeccable (`detect` + Operate critique), design-taste-frontend (anti-slop / dials)  
**Code changes:** None

## Design read

Operate ERP audit for Deed sales/ops users — restrain variance, maximize density and status clarity. Current Sales pilot is Acceptable-to-Strong; peers lag.

## Taste dials (locked for later phases)

| Dial | Value | Rationale |
|------|-------|-----------|
| VARIANCE | **2** | Enterprise familiarity; no experimental layouts |
| MOTION | **2** | Press / drawer only; never tables or money |
| DENSITY | **8** | Cockpit lists, pipeline strip, steppers |

## Method

1. Code review: `Sales.tsx`, `SalesRecordHeader.tsx`, `AppShell` / Sidebar / Topbar, `globals.css` `.sales-pilot*`
2. Spec cross-check: `docs/ERP_UI_SPEC.md`, `design-system/deed-erp/*`
3. Impeccable detector on Sales sources
4. Peer scan: Dashboard / Inventory hardcodes

**Screenshot note:** Live captures saved under `/opt/cursor/artifacts/ux-sales-phase2/` (desktop list, kanban, mobile list, login). Local data showed Quotations empty / Orders=3.

## Screenshot findings (2026-08-06)

| Shot | Finding |
|------|---------|
| `sales-list-desktop.png` | Dual chrome: topbar “Sales & CRM” **and** slate-ink module header “Sales” — competing titles |
| same | Pipeline rail **plus** OperationalSummary cards (“0 Quotations / 3 Sales Orders”) — duplicate metrics |
| same | Emerald CTA + ink header read clearly; empty state OK but Quotations tab while Orders hold data is easy to miss |
| `sales-kanban-desktop.png` | Kanban columns empty on Quotations; top status treatment present; large empty whitespace under density dial 8 |
| `sales-list-mobile.png` | Pipeline becomes 2×2 cards; italic zero stats look weaker than bold “3”; sync-conflict banner competes with header |
| `login.png` | **Glassmorphism + glow + large radius** — consumer/marketing pattern; conflicts with Operate ERP brief (out of Sales module but brand-first surface) |

Artifacts: `/opt/cursor/artifacts/ux-sales-phase2/`

---

## Detector findings

| Target | Result |
|--------|--------|
| `components/modules/Sales.tsx` | **1** finding: `gray-on-color` — `text-gray-600` on `bg-blue-50` (~line 2845) |
| SalesRecordHeader / Sidebar / Topbar | No additional detector hits in scoped pass |

---

## Shell audit

| Surface | Verdict | Notes |
|---------|---------|-------|
| Sidebar | Acceptable | Role-filtered groups; drawer on mobile; active state uses primary→cyan gradient (brand-aligned, watch contrast) |
| Topbar | Acceptable | Search + user; keep calm — avoid new decorative chips |
| AppShell | Good | Skip link, offline banner, toast live region |
| Dashboard | Weak–Acceptable | Multiple `#8B5CF6` KPI colours — generic AI-purple pattern; **out of Sales scope but must not spread** |
| Shared tables | Good foundation | DataTable + TablePageLayout; density OK; enforce across modules |
| Status badges | Good when shared | Prefer `StatusBadge`; local amber “To invoice” micro-label in Sales is OK if contrast holds |
| Modals / drawers | Acceptable | Shared Modal; Sales action menu uses `rounded-xl` + shadow — watch clipping |
| Loading / empty / error | Acceptable | ModuleSkeleton, empty CTA “New quotation”, Confirm dialogs |

---

## Sales module audit (primary)

### Strengths (preserve)

1. **Clear Operate signature** — slate-ink `ModuleHeader`, emerald CTA/icon/active rail (`pages/sales.md`)
2. **Pipeline strip** — Draft quotes · Sent · Confirmed · Ready to invoice (filters + counts, tabular-nums)
3. **Shared chrome** — TabBar, TablePageLayout, DataTable, kanban/table toggle
4. **Detail workflow** — `SalesRecordHeader` + StatusStepper + SmartButtons; invoice gated by permissions
5. **Motion restraint** — press ~120ms; reduced-motion respected in pilot CSS
6. **Kanban craft-floor** — top status bar (not thick left borders)

### Issues

| Severity | Issue | Evidence |
|----------|-------|----------|
| Medium | Dual titles: topbar breadcrumb + module ink header both claim “Sales” | Screenshots |
| Medium | Duplicate metrics: pipeline rail + OperationalSummary stat cards | Screenshots |
| Medium | Detector `gray-on-color` on blue-tinted surface | Sales.tsx ~2845 |
| Medium | Module still ~3k lines — visual + logic coupled; restyle risk if CSS overrides fight Tailwind utilities | `Sales.tsx` |
| Low | Action dropdown `rounded-xl` + `shadow-xl` slightly louder than density dial | Sales.tsx menu |
| Low | Mixed status rendering (`StatusBadge` vs inline amber text) | List columns |
| Low | `.card` wrapper around list surface — acceptable as interaction container; avoid stacking more cards in header | `sales-pilot-surface` |
| Low | Login page glassmorphism/glow (peer surface) | `login.png` |
| Info | Pilot CSS uses `!important` on title sizes — brittle if ModuleHeader markup changes | `globals.css` `.sales-pilot` |

### Anti-patterns checked

| Pattern | Sales? | Notes |
|---------|--------|-------|
| Generic AI purple | No | Emerald/slate — good |
| Excessive cards in hero | No | No marketing hero |
| Thick left borders on kanban | No | Top bar — good |
| Decorative gradients | Mild | Ink header gradient is intentional signature; keep restrained |
| Glassmorphism | No | — |
| Huge headings | No | 1.35rem title |
| Weak hierarchy | No | Header → rail → table is clear |
| Poor table density | No | Matches ERP density goal |
| Missing interaction states | Partial | Shared buttons OK; verify focus rings on pilot CTA |

### Screens that should not change (Phase 6 guardrails)

- Permission gates / commercial freeze / invoice-from-SO rules
- Tab IDs `quotations` / `orders` and list filter keys
- Delivery validate + create-invoice business logic
- Chatter / PDF / email send behaviours
- Dual-write to Prisma + `deed_saleOrders` / invoices

### Screens that may restyle (presentation only)

- List chrome (header, rail, toolbar, table header tint)
- Kanban card surface styling
- Detail header density / stepper contrast
- Empty / loading skeletons styling
- Mobile stack spacing

---

## Peer inconsistency (context for Phase 3)

- **Inventory** navy pilot is strong but different language — Phase 4 must decide: shared Operate chrome with module accent, or keep dual pilots
- **Inventory / Dashboard** indigo & purple leftovers violate MASTER “no purple decorative accents”
- Finance / Repairs not re-audited in depth this pass — assume Acceptable baseline with uneven polish

---

## Sales Operate scorecard (heuristic)

| Criterion | Score /5 | Note |
|-----------|----------|------|
| Task efficiency | 4 | Pipeline filters + dense table |
| Hierarchy | 4 | Ink header reads immediately |
| Brand alignment | 4 | Emerald money accent; not purple |
| Accessibility | 3 | One detector hit; live focus pass still needed |
| Responsiveness | 3 | Mobile works; pipeline card grid + dual metrics eat viewport |
| Table usability | 4 | Shared DataTable; empty Quotations while Orders=3 is a UX trap |
| Form / detail UX | 4 | Stepper + smart buttons (detail not captured — no row open) |
| Consistency vs peers | 3 | Pilot ahead of shell; login still glass/glow |
| **Overall** | **25/40** | **Acceptable** — strong signature, clutter from dual titles + duplicate stats |

---

## Recommendations for Phase 3–4 (no implementation yet)

1. Generate / refresh `design-system/MASTER.md` via UI/UX Pro Max **adapted** to existing tokens (do not invent a second palette).
2. Phase 4 directions for **Sales** (and optionally shared chrome):
   - **A** Conservative refine of current slate-ink + emerald
   - **B** Stronger Deed navy/cyan brand presence while keeping density
   - **C** Premium minimal (precision type/spacing, quieter header)
3. Do **not** start Phase 5 until `prototype` skill is installed.
4. Capture live Sales desktop + mobile screenshots before direction approval.

## Stop

Phase 2 complete. **Await approval before Phase 3.** No application code modified.
