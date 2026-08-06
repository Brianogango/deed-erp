---
name: Deed ERP
description: Operational B2B ERP for Deed Technologies — inventory, sales, repairs, finance
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
typography:
  ui:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  table:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
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
  module-header:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-1}"
  sidebar:
    backgroundColor: "{colors.navy}"
    textColor: "#FFFFFF"
---

# Design

<!-- impeccable:document scan of incumbent visual system — 2026-08-06 -->
<!-- Source of truth for live values remains app/globals.css -->

## Overview

Deed ERP is an **Operate-mode** product UI: light-first slate surfaces, navy sidebar, blue primary actions, dense tables. Two module pilots (Inventory navy command band; Sales slate-ink + emerald) sit ahead of the default compact white module chrome. This file documents the **incumbent** system before Phase 3–4 redesign alternatives.

## Colors

Brand anchors: **navy** `#1A1F5E`, **primary blue** `#2563EB`, **cyan** `#00B0D7`. Semantic status greens/ambers/reds with paired `*-bg` / `*-text` for badges. Page wash `#F1F5F9`; cards white. Dark theme is opt-in via `[data-theme='dark']`.

Do not introduce purple/indigo decorative accents. Prefer CSS variables over hard-coded hex in modules.

## Typography

Single UI family: **Inter** (self-hosted). **DM Mono** for serials, SKUs, tabular money/counts. Fixed rem/px scale (`--fs-ui`, `--fs-table`, `--fs-label`, `--fs-tab`) stepped at 768 / 1536 — not fluid marketing display type.

## Layout

AppShell: collapsible navy sidebar + sticky topbar + `mod-page` workspace. Content max `--content-max` 1440px. Module pattern: `ModuleHeader` → `TabBar` (≤6 + More) → `mod-body` → `TablePageLayout` / `DataTable`. Sidebar off-canvas below 768px.

## Elevation & Depth

Soft slate-tinted shadows (`--shadow-xs` … `--shadow-modal`). Prefer flat table headers over gradients. Avoid glass as decoration; existing drawers/modals use light backdrop blur for focus only.

## Shapes

`--radius-sm/md/lg/full` mapped to controls/cards. Dense ERP should prefer **sm/md**; large `rounded-2xl` on every card is a known inconsistency to resolve in redesign.

## Components

Canonical shared UI: `components/ui` (ModuleHeader, TabBar, Modal, SlidePanel, Badge, EmptyState, …) and `components/erp` (PrimaryActionButton, StatusBadge, TablePageLayout, OperationalSummary, RecordHeader, …). Status must use `StatusBadge` / shared maps — not per-module purple pills.

Pilots:
- `.inventory-pilot` — navy command header + cyan accents
- `.sales-pilot` — slate-ink header + emerald accents

## Do's and Don'ts

**Do**
- Preserve business logic, APIs, permissions, routes
- Use tokens from `globals.css`
- One primary action per viewport
- Compact operational summaries on lists (not KPI card strips)
- 44px touch targets; visible `:focus-visible`; `prefers-reduced-motion`

**Don't**
- Marketing heroes, glassmorphism showcases, huge display headings
- Emoji as UI icons
- Thick colored left borders as the main status language
- Duplicate status colour maps per module
- Animate large tables, money figures, or routine navigation
