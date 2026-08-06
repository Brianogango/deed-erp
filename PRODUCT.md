# Product

<!-- impeccable:product-schema 1 -->

> **Source:** Inferred from repository evidence for UX redesign Phases 1–2 (cloud agent; no live product interview). Facts marked *(inferred)* should be confirmed before Phase 6 implementation freezes.

## Platform

web

## Users

Primary operators of **Deed Technologies**’ Kenya-based ERP (`erp.deed.co.ke`):

| Role | Job *(inferred from `role_access_design.md`, `lib/auth`)* |
|------|----------------------------------------------------------|
| Director | Full operational oversight, settings, audit |
| Sales rep | Quotes, sale orders, CRM, contacts — no stock/PO/invoice post |
| Finance / Admin officer | Invoicing, payments, AR/AP, commercial seals |
| Inventory officer | Stock, serials, transfers, receiving |
| Technical lead / Technician | Repair intake → diagnosis → QA → billing |
| Kilimall officer | Marketplace orders / settlements |

Success for users: complete dense document workflows (quote → SO → delivery → invoice; repair billing; stock movements) quickly, with clear status and without decorative friction.

## Product Purpose

Deed ERP is an **operational ERP** for Deed Technologies’ device sales, inventory, repair, and finance — not a marketing site. It replaces fragmented spreadsheets/tools with one role-gated system for quotations, sale orders, deliveries, invoices, stock/serials, repairs, and accounting.

Success means: trustworthy money/stock numbers, permission-safe actions, and fast list→detail→action loops.

## Positioning

*(inferred)* Odoo-inspired commercial document flows (quotation / SO / DN / invoice) adapted to Deed’s Kenya retail + B2B laptop/repair business, with dual-write blob + Prisma migration in progress and customer portal for repair approvals.

## Operating Context

Main workflows:

1. **Sales** — Quotation → Sent → Confirm SO → Delivery validate → Create invoice → Post/pay
2. **Inventory** — Catalog, serials, GRN, transfers, stock levels
3. **Repairs** — Intake → diagnose → quote → work → QA → invoice/portal
4. **Finance** — Customer invoices, vendor bills, journals, deposits, expenses
5. **CRM / POS / Kilimall / Delivery / HR / SOPs** — supporting modules

Shell: sidebar + topbar (`AppShell`), module pages under `app/*/page.tsx` → `components/modules/*`.

## Capabilities and Constraints

**Must preserve (non-negotiable for redesign):**

- Routes, query params (`/sales?id=&view=`), tab IDs (`quotations` / `orders`)
- Permissions / `roleMatrix` / module grants / finance–sales seals
- Business APIs, Prisma models, dual-write `deed_*` blobs (`docs/BLOB_PRISMA_PARITY.md`)
- Shared chrome: `ModuleHeader`, `TabBar`, `TablePageLayout`, `DataTable`, `StatusBadge`, `RecordHeader`
- DOM contracts for responsive tables (`data-label`, etc. — `docs/DESIGN_SYSTEM.md`)
- Sales pilot signature already shipped: slate-ink + emerald (`design-system/deed-erp/pages/sales.md`)

**Tech stack:** Next.js 14 App Router, React, Tailwind, CSS variables in `app/globals.css`, Font Awesome icons, Inter + DM Mono (`app/fonts.ts`).

**Open / undecided *(inferred)*:** Whether the next Sales restyle **refines** the existing slate-ink pilot or **replaces** it via Phase 4 directions — user requested redesign sequence; treat current pilot as evidence + anti-reference for Directions B/C, preserve for Direction A.

## Brand Commitments

- **Name:** Deed Technologies / Deed ERP
- **Brand colours in tokens:** primary blue `#2563EB`, navy `#1A1F5E`, cyan `#00B0D7`
- **Feel target (user brief):** Dependable, professional, precise, modern, calm, operationally efficient, enterprise-ready
- **Not marketing:** no heroes, glassmorphism, purple-on-white LLM defaults, or consumer motion

## Evidence on Hand

| Asset | Path |
|-------|------|
| Live tokens | `app/globals.css` |
| Design system master | `design-system/deed-erp/MASTER.md` |
| Sales page overrides | `design-system/deed-erp/pages/sales.md` |
| Inventory page overrides | `design-system/deed-erp/pages/inventory.md` |
| UI / UX specs | `docs/ERP_UI_SPEC.md`, `docs/ERP_UX_REFACTOR.md`, `docs/TABLE_PAGE_SYSTEM.md` |
| Role design | `role_access_design.md` |
| Sales module | `components/modules/Sales.tsx`, `sales/SalesRecordHeader.tsx` |
| Sales pilot CSS | `.sales-pilot*` in `app/globals.css` |

No root `PRODUCT.md` / `DESIGN.md` existed before this Phase 1 pass.

## Product Principles

1. **Operate over express** — task completion beats visual novelty.
2. **Density with clarity** — tables and pipelines stay information-rich; hierarchy stays scannable.
3. **One chrome language** — shared ERP components; module pilots may tint, not fork.
4. **Permission-visible UI** — hide/disable what the role cannot do; never imply false power.
5. **Trust the money** — financial figures, statuses, and seals stay accurate and calm.

## Accessibility & Inclusion

Baseline from `docs/ERP_UI_SPEC.md` / tokens:

- Contrast ≥ WCAG AA for text (`--text-4` already raised for muted copy)
- Icon-only controls ≥ 44×44 with `aria-label`
- Visible `:focus-visible`
- `prefers-reduced-motion` collapses motion tokens
- Skip link to `#main-content`
- Labels on form fields (not placeholder-only)
