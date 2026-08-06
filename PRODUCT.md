# Product

<!-- impeccable:product-schema 1 -->
<!-- Revised: 2026-08-06 Phase 1 redo — brief + repo evidence; open decisions marked -->

## Platform

web

## Users

**Deed Technologies staff** using Deed ERP as their daily operating system (desktop/laptop primary; tablet/phone for interruptible checks).

| Role | Situation / job |
|------|-----------------|
| `director` | Owns approvals, users/settings, cross-module oversight |
| `admin_officer` | Coordinates ops; capped customer invoice post/pay |
| `finance_officer` | Invoices, payments, cashbook, recon, payroll approve |
| `inventory_officer` | GRN validate, warehouse, transfers, serials, stock take |
| `sales_rep` | Quotes → orders → delivery handoff; CRM |
| `kilimall_officer` | Marketplace channel operations |
| `technical_lead` | Repair assignment + inventory/tech overlap |
| `technician` | Assigned repair jobs only |

**Always-on self-service** (every authenticated user): leave, expenses, My Documents, KPI Targets, SOPs.

Secondary audiences (separate UI identity — do not merge into staff Operate chrome): customer **portal** and public **track** links.

## Product Purpose

Deed ERP is the **system of record** for Deed’s device retail and service business: serialised inventory, commercial sales documents, workshop repairs/refurbishment, purchases, and finance.

**Success:** staff finish dense transactional work with fewer mistakes and less hunting — not a prettier idle dashboard.

## Positioning

Single-tenant, Odoo-inspired operational ERP specialised for Deed (serials, repairs, Kilimall, deposits, holdovers). It is **not** a multi-tenant marketing SaaS product and must not look like one.

## Operating Context

**Shell:** navy sidebar (grouped + pinned modules) → topbar (search, density, theme, notifications, account) → module workspace.

**Document pattern:** list (search → filters → dense table) → detail (stepper / smart buttons / chatter) → related docs (delivery, invoice, payment).

**Core workflows**
1. Sales: Quotation → Sent → Confirm SO → Delivery → Invoice → Payment (approvals for discounts; commercial freeze after confirm)
2. Inventory: PO → GRN validate → Warehouse / transfers / stock take / serials
3. Repairs: Intake → Assign → Diagnose → Quote → In repair → QC → Ready → Collect (+ portal)
4. Finance: Customer invoices / vendor bills / journals / cashbook / bank recon (posted docs immutable)

**Environments:** Contabo self-host (PM2) production; optional Vercel; local Next 14.

## Capabilities and Constraints

### Must preserve
- HTTP APIs and request/response contracts
- Prisma schema + blob/`app_state` dual-write parity gates
- Role matrix & module grants (`lib/auth/*`), seals/SoD
- Business machines (sales lock, GRN authority, repair statuses, finance immutability)
- Routes, `ModuleId`s, sidebar hrefs, Sales/Inventory tab IDs
- Responsive table DOM contracts (`data-label`, density attrs)
- Stack: Next.js 14 App Router, React 18, Tailwind 3.4, custom `components/ui` + `components/erp` + `components/data-table` (no unnecessary new UI libraries)

### Explicitly out of scope for visual redesign
- Changing permissions, prices, stock maths, or posting rules
- Replacing the DataTable architecture wholesale
- Restyling customer portal as staff ERP chrome

### Open decisions (Phase 4+)
- One global Operate chrome (shared command band) vs compact header with module tints only
- Inventory IA: keep flat tabs vs ≤4 hubs
- Whether Inter remains the sole UI face (Operate preference: yes) vs introducing a second display face (usually no for ERP)

## Brand Commitments

- **Names:** Deed ERP · Deed Technologies · Deed Digital Solutions
- **Logo:** `public/deed-logo.png`, `deed-logo.svg`
- **Colour anchors:** navy `#1A1F5E`, primary `#2563EB`, cyan `#00B0D7`
- **Feel (binding):** dependable, professional, precise, modern, calm, operationally efficient, enterprise-ready
- **Mode:** Impeccable **Operate** — efficiency, density, clarity, a11y, consistency, speed over decorative creativity
- **Ban:** purple/indigo decorative accents; marketing heroes; glassmorphism showcases; consumer-app playfulness

## Evidence on Hand

| Kind | Path |
|------|------|
| Live tokens | `app/globals.css` |
| Design system | `design-system/deed-erp/MASTER.md`, `pages/inventory.md`, `pages/sales.md` |
| UX contracts | `docs/ERP_UX_REFACTOR.md`, `ERP_UI_SPEC.md`, `DESIGN_SYSTEM.md`, `TABLE_PAGE_SYSTEM.md` |
| Role guides | `docs/USER_GUIDE_*.md` |
| Visreg | `docs/visual-regression/` |
| Phase audits | `docs/ux-redesign/` |

Do not invent testimonials, NPS, or fake metrics.

## Product Principles

1. **Task first** — every screen exists to complete an operational job.
2. **One system language** — shared chrome, status, and actions across modules.
3. **Density with clarity** — show needed data; progressive-disclose rarity.
4. **Trust through precision** — money, stock, and approvals must be unambiguous.
5. **Accessible by default** — WCAG AA, keyboard, ≥44px targets, reduced motion.

## Accessibility & Inclusion

- WCAG AA contrast for text and UI components
- Icon-only controls: `aria-label` (not title-only)
- Touch targets ≥ 44×44 where practical
- Honour `prefers-reduced-motion`
- Light mode = primary Operate surface; dark is opt-in
