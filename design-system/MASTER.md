# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.
>
> **Live token source of truth:** `app/globals.css` (`:root`, `[data-theme='dark']`).
> This document is normative for redesign Phases 3–8. Do **not** invent a second palette.
>
> Legacy path `design-system/deed-erp/` mirrors this file for older references.

---

**Project:** Deed ERP  
**Updated:** 2026-08-06 (Phase 3 — UI/UX Pro Max adapted)  
**Category:** B2B SaaS ERP — inventory, sales, repair, finance  
**Mode:** Operate (Impeccable)  
**Taste dials:** VARIANCE **2** · MOTION **2** · DENSITY **8**

---

## Pro Max intake → adaptations

| Pro Max suggestion | Decision |
|--------------------|----------|
| Style: Data-Dense Dashboard | **Adopt** — primary Operate style |
| Style: Minimalism / Swiss | **Adopt as Direction C** baseline |
| Style: Trust & Authority | **Adopt cues** (navy/grey integrity) — not landing badges |
| Pattern: Enterprise Gateway (hero, logos) | **Reject** — marketing pattern; ERP is task UI |
| Colors: Primary `#1E40AF` + amber CTA `#F59E0B` | **Reject swap** — keep Deed `#2563EB`; CTA = primary or module success; never amber decoration |
| Colors: SaaS `#2563EB` | **Keep** — matches live `--primary` |
| Typography: Fira Code + Fira Sans | **Reject** — keep self-hosted **Inter** + **DM Mono** (no Google Fonts dependency) |
| Effects: chart zoom, filter animations | **Limit** — row hover + 150–220ms only; no chart zoom choreography |
| Anti-pattern: ornate / no filtering | **Adopt** |

Stack: Next.js 14 + React + Tailwind + existing `components/ui` / `erp` / `data-table`. **Do not install** Fluent/Carbon/new UI libraries unless Phase 6 explicitly chooses (pick-ui-library later). Prefer token + shared chrome.

---

## Global Rules

### Color tokens (normative)

| Role | Hex (light) | CSS variable |
|------|-------------|--------------|
| Primary | `#2563EB` | `--primary` |
| Primary dark | `#1D4ED8` | `--primary-dark` |
| Primary light | `#DBEAFE` | `--primary-light` |
| Navy (brand) | `#1A1F5E` | `--navy` |
| Cyan accent | `#00B0D7` | `--accent-cyan` |
| Page | `#F1F5F9` | `--bg-page` |
| Surface | `#F8FAFC` | `--bg-surface` |
| Card | `#FFFFFF` | `--bg-card` |
| Text 1–4 | `#0F172A` … `#64748B` | `--text-1` … `--text-4` |
| Border | `#CBD5E1` | `--border` |
| Success | `#059669` | `--success` |
| Warning | `#D97706` | `--warning` |
| Danger | `#DC2626` | `--danger` |
| Info | `#2563EB` | `--info` |

**Forbidden in product modules:** purple/indigo decorative hexes (`#8B5CF6`, `#4F46E5`, `#6366F1`), glassmorphism, neon glows, amber as primary CTA.

### Typography

| Role | Face | Notes |
|------|------|-------|
| UI / headings | Inter (`--font-inter`) | Fixed rem scale — no fluid marketing clamp |
| Data / money | DM Mono (`--font-dm-mono`) | `tabular-nums` for money & counts |
| Scale | `--fs-ui` / `--fs-table` / `--fs-label` / `--fs-tab` | Steps at 768 / 1536 |

Ratio ~1.125–1.2 between steps. One family for UI labels; mono only for data.

### Spacing & grid

| Token | Value | Use |
|-------|-------|-----|
| `--space-1`…`--space-8` | 4–32px | Tight → section |
| `--page-gutter` | 16 → 24 → 32 | Page padding |
| `--content-max` | 1440px | Module content |
| `--table-row-height` | 48px | Default density |

Layout: sidebar + topbar + main. 12-column mental grid inside content; lists prefer full width within max.

### Borders, radius, shadows

| Token | Rule |
|-------|------|
| `--radius-sm` `0.5rem` | Buttons, inputs, badges (default) |
| `--radius-md` `0.75rem` | Panels |
| `--radius-lg` `1rem` | Rare — modals only |
| Shadows | `--shadow-xs`…`--shadow-modal` — restrained; no multi-layer glow |

Prefer hairline borders (`--border` / `--border-lt`) over heavy elevation for tables.

### Table density

- Default: compact rows (48px), sticky header, sortable columns via DataTable
- Money right-aligned + mono
- Mobile: card/stack via `.erp-responsive-table` / DataTable mobile — no mandatory horizontal scroll for primary columns
- One checkbox column + bulk action bar when bulk exists
- Empty: actionable CTA (e.g. New quotation), not blank void

### Form density

- `Field` + visible label; required marker
- Single column on &lt;768; multi-column only when labels stay aligned
- Errors: near field + `role="alert"` / aria-live where async
- Disable submit while saving; show explicit progress label

### Navigation

- Sidebar: role-filtered groups; active = primary (or page-override accent), **no glow bloom**
- Topbar: search, notifications, user — one page title region only (avoid dual module titles)
- Tabs: `TabBar` ≤6; active = high contrast underline or filled chip per page override
- Breadcrumb optional; never duplicate ModuleHeader title verbatim

### Status colours

Use `StatusBadge` / semantic `--success|warning|danger|info` + `*-bg` / `*-text`.  
Payment vs document state stay separate (Odoo-style): doc = draft/posted/cancelled; payment derived.

### Responsive

Breakpoints: 480 / 768 / 1024 / 1280 / 1536.  
Sidebar → drawer &lt;768. Pipeline strips → 2×2 grid on phone. Modals full-bleed on small screens.

### Accessibility

- Contrast ≥ 4.5:1 body; ≥ 3:1 large/UI chrome
- Focus-visible rings (`--primary`)
- Icon-only ≥ 44×44 + `aria-label`
- Skip link `#main-content`
- `prefers-reduced-motion: reduce` → motion ≈ 1ms

### Charts

- Prefer **simple bar / line / sparkline** for KPIs; no ornamental 3D
- Financial figures: never animate digit rolls
- Color-blind safe: pair color with label/icon, not color alone
- Dashboard: max one accent series + neutrals

### Motion limits

| Allowed | Duration |
|---------|----------|
| Button press / hover | ≤ 150ms |
| Drawer / modal enter | ≤ 220ms |
| Toast | ≤ 220ms |
| Sidebar collapse | ≤ 220ms |

**Never animate:** large tables, money totals, routine route changes, filter typing.

### Module chrome contract

1. **One** command header (ModuleHeader) — topbar shows section label or omits duplicate H1  
2. Optional **one** pipeline/summary strip (not both strip + KPI card row)  
3. TabBar → TablePageLayout / detail  
4. One primary CTA; overflow in SecondaryActionMenu  

---

## Component map (reuse — do not duplicate)

| Need | Use |
|------|-----|
| Header | `ModuleHeader` |
| Tabs | `TabBar` |
| List | `TablePageLayout` + `DataTable` |
| Status | `StatusBadge` / `Badge` |
| Detail | `RecordHeader` / module RecordHeader |
| Actions | `PrimaryActionButton` |
| States | `StatePanel` / skeletons / `EmptyState` |
| Icons | `@/components/icons` (Font Awesome) |

---

## Page overrides

| Page | File |
|------|------|
| Sales | `design-system/pages/sales.md` |
| Inventory | `design-system/pages/inventory.md` (legacy: `deed-erp/pages/inventory.md`) |

Create a new override **only** when a module needs a distinct signature (accent + header treatment). Default modules follow this Master.

---

## Do / Don't

**Do:** tokens only · density 8 · shared chrome · permission-visible UI · calm status language  

**Don't:** heroes · glass · purple accents · duplicate titles/metrics · new UI libraries by default · decorative motion · emoji icons  

---

## Pre-delivery checklist

- [ ] No emoji icons  
- [ ] `cursor-pointer` on clickables  
- [ ] Hover/focus 150–220ms  
- [ ] AA contrast  
- [ ] Focus rings  
- [ ] Reduced motion respected  
- [ ] 375 / 768 / 1024 / 1440 checked  
- [ ] Async controls disabled in flight  
- [ ] Status via shared badges  
- [ ] Colors from `globals.css` only  
- [ ] No dual page titles / duplicate KPI strips  
