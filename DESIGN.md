---
name: Deed ERP
description: Operational ERP for Deed Technologies — inventory, sales, repairs, finance (Operate mode)
colors:
  primary: "#2563EB"
  primary-dark: "#1D4ED8"
  primary-light: "#DBEAFE"
  navy: "#1A1F5E"
  navy-dark: "#161A50"
  accent-cyan: "#00B0D7"
  accent-slate: "#1E293B"
  bg-page: "#F1F5F9"
  bg-surface: "#F8FAFC"
  bg-card: "#FFFFFF"
  bg-muted: "#EEF2F7"
  border: "#CBD5E1"
  border-lt: "#E2E8F0"
  border-strong: "#94A3B8"
  text-1: "#0F172A"
  text-2: "#1E293B"
  text-3: "#475569"
  text-4: "#64748B"
  success: "#059669"
  warning: "#D97706"
  danger: "#DC2626"
  info: "#2563EB"
  success-text: "#047857"
  warning-text: "#92400E"
  danger-text: "#B91C1C"
  info-text: "#1E40AF"
typography:
  ui:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  table:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.04em"
  mono:
    fontFamily: "DM Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  full: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
    textColor: "#FFFFFF"
  module-header-default:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-1}"
  sidebar:
    backgroundColor: "{colors.navy}"
    textColor: "#FFFFFF"
  status-success:
    backgroundColor: "rgba(5, 150, 105, 0.10)"
    textColor: "{colors.success-text}"
---

# Design

<!-- impeccable:document — Phase 1 redo scan of incumbent system, 2026-08-06 -->
<!-- Live SoT: app/globals.css. This file describes what EXISTS, including known fractures. -->

## Overview

Deed ERP’s incumbent look is a **light-first Operate UI**: navy sidebar, blue primary actions, slate neutrals, dense tables. Two experimental **module pilots** diverge on purpose today:

| Pilot | Signature |
|-------|-----------|
| Inventory `.inventory-pilot` | Navy command band + cyan underline |
| Sales `.sales-pilot` | Slate-ink command band + emerald CTA/underline |

Most other modules still use the **default compact white** `ModuleHeader`. That unevenness is a documented Phase 2 issue, not the target end-state.

## Colors

**Brand:** navy `#1A1F5E`, primary blue `#2563EB`, cyan `#00B0D7`.  
**Neutrals:** cool slate page/surface/card/border/text scale.  
**Status:** success / warning / danger / info with paired `*-bg` / `*-text`.  
**Shell:** `--sidebar-*` tokens for navy gradient rail and active cyan-blue pill.

**Violations still in code (anti-reference):** purple `#8B5CF6` / violet & pink status hexes in Repair/Refurb (`repair-config.ts`, Refurbishment header).

## Typography

**Inter** (self-hosted variable) for UI. **DM Mono** for serials, SKUs, and tabular counts/money.  
Scale tokens: `--fs-ui` / `--fs-table` / `--fs-label` / `--fs-tab`, stepped at 768px and 1536px.  
Operate rule: **no marketing display face**; do not replace Inter with a “characterful” landing font.

## Layout

AppShell → `mod-page` → `ModuleHeader` → `TabBar` (≤6 + More) → `mod-body` → `TablePageLayout` / `DataTable`.  
`--content-max: 1440px`. Sidebar off-canvas below 768px.  
Topbar currently repeats route title alongside ModuleHeader (hierarchy conflict — Phase 2).

## Elevation & Depth

Slate-tinted soft shadows (`--shadow-xs` … `--shadow-modal`). Flat `--table-head-bg`.  
Backdrop blur appears on overlays (search, drawers) for focus — not as decorative glass panels.

## Shapes

`--radius-sm/md/lg/full`. Cards/modals often use `--radius-lg` / `rounded-2xl` — **over-rounded for dense ERP** relative to controls; candidate to tighten in Phase 3–4.

## Components

**Canonical:** `components/ui` (ModuleHeader, TabBar, Modal, SlidePanel, Badge, EmptyState, skeletons…) and `components/erp` (PrimaryActionButton, StatusBadge, TablePageLayout, OperationalSummary, RecordHeader, FilterDrawer, PermissionDeniedState…).  
**Tables:** `components/data-table/*`.  
**Status rule:** use `StatusBadge` / shared maps — not per-module left-border colour dialects.

## Do's and Don'ts

**Do**
- Prefer CSS variables from `globals.css`
- One primary action per viewport
- Compact operational summaries on lists (not KPI card strips)
- Press-only micro-motion; honour reduced motion
- Keep information density high

**Don't**
- Marketing heroes, glassmorphism showcases, huge display headings
- Purple/indigo decorative accents
- Thick coloured left borders as primary status language
- Emoji as icons
- Animate large tables, financial figures, or routine navigation
- Apply landing-page Taste defaults (grain heroes, asymmetric marketing grids, Inter replacement) to Operate screens
