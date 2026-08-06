# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are **Deed Technologies staff** operating day-to-day retail/service ERP workflows on desktop and tablet (phone for interruptible checks).

| Role | Typical job |
|------|-------------|
| `director` | Oversight, approvals, settings, full module access |
| `admin_officer` | Cross-ops coordination; capped finance posting |
| `finance_officer` | Invoices, payments, cashbook, bank recon, payroll approve |
| `inventory_officer` | Stock, GRN validation, transfers, serials |
| `sales_rep` | Quotations, orders, deliveries, CRM |
| `kilimall_officer` | Marketplace channel ops |
| `technical_lead` | Repair assignment, inventory/tech overlap |
| `technician` | Assigned repair jobs |

Self-service baseline for every logged-in user: HR/leave, expenses, My Documents, SOPs.

<!-- inferred from lib/auth/types.ts, authorization.ts, USER_GUIDE_*.md; confirmed by redesign brief -->

## Product Purpose

**Deed ERP** is the operational system of record for Deed Technologies: inventory with serial tracking, B2B/retail sales (quote → order → delivery → invoice → payment), repair/refurbishment workflows, purchases, finance, and people ops.

Success means staff complete dense transactional work **faster and with fewer errors** than spreadsheets or fragmented tools — without decorative UI getting in the way.

## Positioning

Odoo-inspired **single-tenant operational ERP** tailored to Deed’s device retail/service business (serials, repairs, Kilimall, deposits, holdovers), not a generic marketing SaaS dashboard.

## Operating Context

- Authenticated AppShell: navy sidebar + topbar + module workspace
- Dense tables (search → filters → DataTable), document detail with steppers/smart buttons
- Approvals (discounts, purchases, inventory), seals/SoD for finance
- Customer portal / track links for repairs and quotes (separate surfaces)
- Production Contabo self-host (PM2) and optional Vercel path

Main workflows:
1. **Sales:** Quotation → Sent → Confirm SO → Delivery → Invoice → Payment
2. **Inventory:** PO → GRN validate → Warehouse / transfers / stock take / serials
3. **Repairs:** Intake → Assign → Diagnose → Quote → In repair → QC → Ready → Collect
4. **Finance:** Customer invoices / vendor bills / journals / cashbook / recon

## Capabilities and Constraints

**Must preserve (non-negotiable for redesign):**
- APIs, Prisma schema, blob/Prisma dual-write parity
- Role matrix and module permissions (`lib/auth/*`)
- Business rules (posted invoice immutability, sales commercial freeze, GRN authority, repair status machine)
- Routes, ModuleIds, DOM contracts for responsive tables (`data-label`, etc.)
- Existing Next.js 14 + Tailwind + custom `components/ui` + `components/erp` stack

**Open / undecided for redesign:**
- Whether every module gets full “command band” chrome or a quieter compact header
- Whether Inventory’s many tabs are regrouped (IA change vs visual-only)
- Final global visual direction (Phase 4 alternatives A/B/C)

**Stack (incumbent):** Next.js 14.2 App Router, React 18, TypeScript, Tailwind 3.4, Prisma 7, next-auth, Font Awesome (+ Lucide in deps), Recharts, Inter + DM Mono (self-hosted).

## Brand Commitments

- Name: **Deed ERP** / Deed Technologies / Deed Digital Solutions
- Brand colours in tokens: navy `#1A1F5E`, primary blue `#2563EB`, cyan `#00B0D7`
- Logo: `public/deed-logo.png` / `.svg`
- Feel (binding from redesign brief): dependable, professional, precise, modern, calm, operationally efficient, enterprise-ready
- Not a marketing website — Operate mode; density and clarity over decoration
- Avoid purple/indigo decorative accents outside brand tokens

## Evidence on Hand

- Live tokens: `app/globals.css` `:root` / `[data-theme='dark']`
- Design docs: `design-system/deed-erp/MASTER.md`, `docs/DESIGN_SYSTEM.md`, `docs/ERP_UI_SPEC.md`, `docs/ERP_UX_REFACTOR.md`
- Module pilots: `design-system/deed-erp/pages/inventory.md`, `sales.md`
- Role guides: `docs/USER_GUIDE_*.md`
- Visreg routes: `docs/visual-regression/`
- Do **not** fabricate testimonials, metrics, or customer quotes

## Product Principles

1. **Task first** — every screen exists to complete an operational job.
2. **One system language** — shared chrome, status, and actions across modules.
3. **Density with clarity** — show the data operators need; hide rare actions.
4. **Trust through precision** — money, stock, and approvals must be unambiguous.
5. **Accessible by default** — WCAG AA contrast, keyboard, 44px targets, reduced motion.

## Accessibility & Inclusion

- Target WCAG AA for text/UI contrast
- Icon-only controls require `aria-label`; touch targets ≥ 44×44 where practical
- Respect `prefers-reduced-motion`
- Light mode is the primary Operate surface; dark is opt-in via theme toggle
