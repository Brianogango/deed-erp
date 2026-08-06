# Phase 7 — Motion (Sales / Direction B)

**Date:** 2026-08-06  
**Skills:** `find-animation-opportunities`, `improve-animations` (audit → implement)  
**Taste dial:** MOTION **2** — press / state only; never tables or money  
**Scope:** Sales module (`.sales-pilot*`, MoreActionsMenu)

## Recon

| Fact | Value |
|------|-------|
| Stack | Next.js + plain CSS / Tailwind utilities; no Framer Motion in Sales |
| Existing motion | Rail + kanban press `scale(0.99)` @ 120ms ease-out; reduced-motion block |
| Personality | Operate ERP — crisp, restrained |
| High-frequency | Tab switches, table hover, rail filters (tens+/day) |

## Gate audit (opportunities)

| Candidate | Frequency | Purpose | Verdict |
|-----------|-----------|---------|---------|
| Header CTA `:active` press | Occasional | Feedback | **Ship** — `scale(0.97)` 120ms ease-out |
| Tab hover/active color | Tens/day | State indication | **Ship subtle** — 120ms bg/color only (no scale) |
| More-actions chevron rotate | Occasional | State indication | **Ship** — 150ms ease-out |
| Table row enter / money count-up | 100+/day | — | **Reject** — dial + Gate #1/#4 |
| Kanban column stagger | Occasional | Delight | **Reject** — MOTION 2; empty columns common |
| Modal scale-from-zero | Occasional | — | **Reject** — shared Modal; out of Sales chrome scope |
| Pipeline rail press | Already shipped | Feedback | Keep |

## Implemented

| Change | Location | Spec |
|--------|----------|------|
| Header primary/secondary press | `app/globals.css` `.sales-pilot .mod-header .btn-*` | `transform: scale(0.97)` + 120ms ease-out on transform |
| Tab color ease | `.sales-pilot .mod-tab` | `background-color`/`color` 120ms ease-out |
| Chevron rotate | `Sales.tsx` MoreActionsMenu | `duration-150 ease-out` |
| Reduced-motion | `.sales-pilot` media query | Covers header CTAs + tabs + rail + kanban |

## Explicit non-goals

- No `transition: all`
- No animation on DataTable rows, totals, or status chips
- No keyframe celebrations on invoice/confirm

## Feel-check

1. Click **New quotation** — brief press dip, no lag after release  
2. Switch Quotations ↔ Orders — color settles ≤120ms, no bounce  
3. Open More → chevron flips smoothly; menu appears instantly (no fade delay)  
4. OS reduced-motion on → presses/transforms off  
