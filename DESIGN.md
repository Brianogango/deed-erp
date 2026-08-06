---
name: Deed ERP
description: Operational ERP for Deed Technologies — sales, inventory, repair, finance
colors:
  primary: "#2563EB"
  primary-dark: "#1D4ED8"
  primary-light: "#DBEAFE"
  navy: "#1A1F5E"
  navy-dark: "#161A50"
  accent-cyan: "#00B0D7"
  bg-page: "#F1F5F9"
  bg-surface: "#F8FAFC"
  bg-card: "#FFFFFF"
  text-1: "#0F172A"
  text-2: "#1E293B"
  text-3: "#475569"
  text-4: "#64748B"
  border: "#CBD5E1"
  success: "#059669"
  warning: "#D97706"
  danger: "#DC2626"
  info: "#2563EB"
typography:
  ui:
    fontFamily: "var(--font-inter), Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  table:
    fontFamily: "var(--font-inter), Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
  mono:
    fontFamily: "var(--font-dm-mono), ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
    textColor: "#FFFFFF"
  sales-pilot-cta:
    backgroundColor: "{colors.success}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
---

# Design

<!-- impeccable:document — incumbent scan of live tokens + pilots; not a replacement world -->

## Overview

Deed ERP is an **Operate**-mode product UI: dense tables, document steppers, role-gated actions. Visual authority lives in `app/globals.css` CSS variables, shared `components/ui` + `components/erp` + `components/data-table`, and module pilots (Sales slate-ink + emerald; Inventory navy + cyan).

This file **documents the incumbent system** before Phase 3–4 redesign choices. It is not permission to invent a marketing aesthetic.

**Taste dials (ERP Operate):** VARIANCE **2–3** · MOTION **2** · DENSITY **8**.

## Colors

Brand: primary blue, Deed navy, cyan accent. Surfaces: cool slate page/card stack. Status: success / warning / danger / info with dedicated `*-bg` / `*-text` for badges.

**Sales pilot** remaps primary CTA and active chrome to **emerald (`--success`)** on a **slate-ink header** — deliberately distinct from Inventory’s navy band.

**Avoid in product modules:** purple/indigo decorative accents (`#8B5CF6`, `#4F46E5`), glassmorphism, full-bleed hero gradients, dark-mode-first shells.

## Typography

- **UI:** Inter via `--font-inter` — fixed rem scale (`--fs-ui`, `--fs-table`, `--fs-label`, `--fs-tab`), not fluid marketing clamp.
- **Data / money:** DM Mono + `tabular-nums` where already used.
- Module titles on Sales pilot: ~1.35rem, weight ~750, white on ink header.

## Layout

- Shell: collapsible sidebar (&lt;768 drawer) + topbar + `#main-content`.
- Module: `ModuleHeader` → optional pipeline/stats → `TabBar` → `TablePageLayout` / detail.
- Content max width `--content-max: 1440px`; gutters `--page-gutter` 16→24→32.
- Tables: dense rows (`--table-row-height: 48px`); mobile card collapse via responsive table contracts.

## Elevation & Depth

Restrained shadows (`--shadow-xs` … `--shadow-modal`). Sales pilot header uses a soft ink shadow; avoid multi-layer glow. Cards are structural containers for lists/forms — not decorative stacks in the first viewport of a module.

## Shapes

Radius scale `--radius-sm/md/lg`. Prefer `sm`–`md` for ERP controls. Sales kanban: **top status bar**, not thick left borders (craft-floor). Avoid `rounded-3xl` / pill clusters for operational chrome.

## Components

Canonical shared set:

| Concern | Component |
|---------|-----------|
| Module title | `ModuleHeader` |
| Tabs | `TabBar` (≤6) |
| Lists | `TablePageLayout` + `DataTable` |
| Status | `StatusBadge` / `Badge` |
| Detail | `RecordHeader` / `SalesRecordHeader` + `StatusStepper` |
| Actions | `PrimaryActionButton` + overflow menu |
| States | `StatePanel` / skeletons / `EmptyState` |

Sales-specific: `.sales-pilot`, `.sales-pilot-rail`, `.sales-pilot-stat`, `.sales-pilot-surface` in `globals.css`.

## Do's and Don'ts

**Do**

- Use CSS variables — never hardcode competing module accent hexes
- Keep one primary CTA per viewport
- Preserve list filters, tab IDs, steppers, and permission gates
- Respect `prefers-reduced-motion` (press feedback ~120–180ms only)

**Don't**

- Add hero sections, glass panels, or decorative motion on tables/money
- Fork a second button/badge system inside a module
- Copy Inventory navy onto Sales (or vice versa) without an explicit direction decision
- Change APIs, permissions, or dual-write behaviour for visual work
