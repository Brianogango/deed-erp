# Deed ERP — Sprint Plan

Governing rule: **no two agents touch the same file in the same sprint.** Where two work packages share a file (noted below), they are sequenced, not parallelized.

## Sprint 0 — Human decisions + safety prerequisites (before any code work)
**Duration:** as fast as the business owner can respond; does not block Sprint 1's non-conflicting items.

| Action | Owner | Blocks |
|---|---|---|
| Decisions 1–7 requested (see `06_DECISIONS_REQUIRED.md`) | Director | DEED-005 (fully), DEED-006 (permission gating), FIN-002b (deferred anyway), DEED-001 (session policy), SEC-002 (retention), SRV-001/SRV-003 (windows/destination) |
| Confirm current backup is restorable (re-verify, do not just trust the Addendum) | DevOps | All P0 infra work |
| Human operator identified and available for SRV-001's final switch | Director | P0-SRV-001 |

## Sprint 1 — "Stop the bleeding" (P0 safety net)
**Can run fully in parallel** — no two P0 packages share a file:

| Package | Agent | Files touched | Depends on |
|---|---|---|---|
| P0-FIN-001 | Backend | `lib/finance-invoice.ts`, `app/api/store/route.ts`, `app/api/store/[key]/route.ts`, `app/api/invoices/[id]/route.ts` | none |
| P0-SRV-001 | DevOps + human | sshd config, ufw (infra only, no repo files) | Sprint 0's human-operator availability |
| P0-SRV-003 | DevOps | backup script (infra only, no repo files) | Decision 7 (offsite destination) |
| P0-SEC-002 | Backend | `app/api/store/route.ts` (⚠ **shares this file with P0-FIN-001** — sequence: FIN-001 lands first, SEC-002 rebases on top), `lib/auth/authorization.ts`, `prisma/schema.prisma` (new table) | Decision 5 (retention); land after FIN-001 |
| P0-DEED-001 | Frontend + Backend | `lib/auth/session.ts`, `middleware.ts`, `components/AppShell.tsx`, new `hooks/useFormDraft.ts`, repair intake / quotation / journal forms | Decision 4 (session policy) |

**File-conflict note:** FIN-001 and SEC-002 both touch `app/api/store/route.ts`. Land FIN-001's PR first; SEC-002's branch rebases before merging.

**Security review required:** FIN-001, SEC-002, DEED-001 (session/auth-adjacent).
**Business-owner validation required:** FIN-001 (correction workflow list), SEC-002 (retention), DEED-001 (session policy).
**Downtime:** none for any Sprint 1 item.
**Database migration:** SEC-002 only (additive archive table).

## Sprint 2 — "Trust the numbers" (P1, first half)
Can mostly run in parallel; two file-sharing pairs noted.

| Package | Agent | Files touched | Conflicts with |
|---|---|---|---|
| P1-FIN-002 | Backend | `lib/store.tsx` (seq call sites), `app/api/doc-numbers/route.ts` | **Shares `lib/store.tsx` with P0-DEED-001** — sequence after DEED-001 lands, or coordinate a merge |
| P1-DATA-001 | Backend/DB | refund-ref generation (`lib/store.tsx`), repair-intake validation | Same `lib/store.tsx` — sequence after FIN-002 |
| P1-SEC-005 | Backend | `app/api/store/route.ts` (⚠ third package touching this file — land after FIN-001 + SEC-002 both merge) | FIN-001, SEC-002 |
| P1-DEED-004 | Frontend/A11y | `components/ui/index.tsx` (shared Field/Input) + 4 named forms | none (independent of the backend-heavy items above) |
| P1-DEED-002-003 | Frontend/A11y | `app/globals.css`, `components/ui/index.tsx` (⚠ **shares `components/ui/index.tsx` with DEED-004** — do both in one coordinated branch or sequence) | DEED-004 |
| P1-DEED-007 | Frontend | Purchases module + shared filter component | none |
| P1-DEED-011-012 | Frontend | Finance invoice bulk-action bar | none |

**Recommended within-sprint order:** DEED-002-003 lands first (adds the shared-component groundwork), then DEED-004 builds on it in the same file without conflict. FIN-002 and DATA-001 sequence after DEED-001 (Sprint 1) is merged, since all three touch `lib/store.tsx`.

**Security review required:** SEC-005.
**Business-owner validation required:** none new this sprint (DEED-005/006 deferred to Sprint 3 pending decisions).
**Downtime:** none.
**Database migration:** none.

## Sprint 3 — "Complete the surfaces" (P1, second half — needs decisions)
| Package | Agent | Depends on |
|---|---|---|
| P1-DEED-005 | Frontend + Backend | **Decision 1** (blocks final default-value change; UI-visibility half can ship without it) |
| P1-DEED-006 | Full-stack | **Decision 2** (blocks permission gating; schema/API/archive half can ship as Director-only default) |
| P1-DEED-008 | Frontend | none; coordinate with P1-DEED-002-003 (dark-mode focus-ring contrast) |
| P1-DEED-010 | Frontend | none |
| P1-ARCH-001 | Backend/DB | none blocking, but large — treat as its own multi-week track, not a single-sprint item; slices land independently |

**Database migration:** DEED-006 (contact archive flag + merge-log table, additive); ARCH-001 (per-slice backfills, additive).
**Security review required:** DEED-006 (relink correctness).
**Business-owner validation required:** DEED-005 (Decision 1), DEED-006 (Decision 2), each ARCH-001 certificate (informational).

## Sprint 4 — "Reliability and polish" (P2)
| Package | Agent | Depends on |
|---|---|---|
| P2-SRV-002-005 | DevOps | **Must follow P0-SRV-001** (uses the hardened SSH access pattern) |
| P2-DEED-QW | Frontend | none (low risk, can slot in anywhere after Sprint 2's shared-component work lands) |
| P2-DEED-035-FUNC-002 | ERP Functional + Data | Phase A (analysis) has no dependency; Phase B needs business-owner sign-off on findings |
| FUNC-001 (server-side approval thresholds) | Backend + ERP Functional | role/threshold matrix confirmation |

## Sprint 5+ — Planned maturity (P3)
- DEED-037 (design-token/button consolidation) — after all P1/P2 UI work, to avoid rebasing visual changes repeatedly.
- Workstream I (role/mobile/AT coverage audits) — can start any time in parallel; it is verification-only and touches no shared files.
- FIN-002b (numbering convention standardisation) — needs Decision 3; deliberately deferred past the functional fix in P1-FIN-002.
- DEED-025 (phone validation/name normalisation/contact cleanup).

## Cross-cutting notes
- **Downtime:** no package in this plan requires application downtime. Database migrations (SEC-002 archive table, DEED-006 archive/merge-log, ARCH-001 backfills) are all additive and applied via the standard non-destructive migration pattern already used in prior PRs (#221–#228).
- **Security review checkpoints:** FIN-001, SEC-002, SEC-005, DEED-001, DEED-006, SRV-001, SRV-003.
- **Business-owner validation checkpoints:** FIN-001, SEC-002, DEED-001, DEED-005, DEED-006, ARCH-001 (informational), FUNC-001.
- **Backend-first dependencies:** DEED-005's default-value change waits on Decision 1; DEED-006's permission gating waits on Decision 2; none of the frontend a11y/UI work is blocked by any backend work.
