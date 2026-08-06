# Deed ERP — Dependency Map

## Legend
- **Depends on:** must land first
- **Blocks:** cannot proceed until this completes
- **Shares files with:** must be sequenced or coordinated, not run as truly independent parallel branches
- **Needs decision:** business-owner input required (see `06_DECISIONS_REQUIRED.md`)

## P0 — no dependencies among themselves except one file overlap
| Package | Depends on | Blocks | Shares files with | Needs decision | Downtime | Migration | Security review | Owner validation |
|---|---|---|---|---|---|---|---|---|
| P0-FIN-001 | — | P0-SEC-002 (file order) | `app/api/store/route.ts` (with SEC-002, SEC-005) | Correction workflow list | No | No | Yes | Yes |
| P0-SRV-001 | Human operator availability | P2-SRV-002-005 | none (infra) | Maintenance window | No | No | Yes | Custodian of new creds |
| P0-SRV-003 | Decision 7 (offsite destination) | none | none (infra) | Offsite destination | No | No | Yes | Owns storage account |
| P0-SEC-002 | P0-FIN-001 (file order, not functional) | P1-DEED-006's audit coordination | `app/api/store/route.ts`, `prisma/schema.prisma` | Retention duration | No | Yes (additive archive table) | Yes | Yes |
| P0-DEED-001 | — | P1-FIN-002, P1-DATA-001 (file order) | `lib/store.tsx` (with FIN-002, DATA-001) | Session timeout policy | No | No | Yes (auth-adjacent) | Yes |

## P1 — mostly independent; two file-sharing clusters
| Package | Depends on | Blocks | Shares files with | Needs decision | Downtime | Migration | Security review | Owner validation |
|---|---|---|---|---|---|---|---|---|
| P1-FIN-002 | P0-DEED-001 (file order) | none | `lib/store.tsx` (with DEED-001, DATA-001) | Numbering convention deferred to P3 | No | No | No | No |
| P1-ARCH-001 | shipped parity tooling (#228, done) | full ARCH-001 closure | none | none per slice | No | Yes (additive per slice) | No (DB review per slice) | Informational only |
| P1-SEC-005 | P0-FIN-001, P0-SEC-002 (file order) | none | `app/api/store/route.ts` (third package on this file) | none | No | No | Yes | No |
| P1-DEED-004 | P1-DEED-002-003 (recommended order, same shared component) | none | `components/ui/index.tsx` (with DEED-002-003) | none | No | No | No | No |
| P1-DEED-002-003 | — | P1-DEED-004 (recommended order) | `components/ui/index.tsx`, `app/globals.css` | none | No | No | No | No |
| P1-DEED-005 | Decision 1 (full closure); UI-visibility half independent | none | none | Default payment terms | No | No | No | Yes |
| P1-DEED-006 | Decision 2 (permission gating); schema/API independent | none | none | Merge policy | No | Yes (additive) | Yes | Yes |
| P1-DEED-007 | — | none | none | none | No | No | No | No |
| P1-DEED-008 | coordinate with DEED-002-003 (focus-ring dark contrast) | none | `app/globals.css` (with DEED-002-003) | none | No | No | No | No |
| P1-DEED-010 | — | none | none | none | No | No | No | No |
| P1-DEED-011-012 | — | none | none | none | No | No | No | No |
| P1-DATA-001 | P0-DEED-001, P1-FIN-002 (file order) | none | `lib/store.tsx` | Corrected values for 2 known bad records | No | No | No | Yes |

## P2 — sequenced after specific P0/P1 items
| Package | Depends on | Blocks | Shares files with | Needs decision | Downtime | Migration | Security review | Owner validation |
|---|---|---|---|---|---|---|---|---|
| P2-SRV-002-005 | P0-SRV-001 (must complete first) | none | none (infra) | Alert recipients | No (brief PM2 handover, seconds) | No | No | No |
| P2-DEED-QW | recommend after P1-DEED-002-003/004 land (shared component maturity) | none | multiple small files, no true conflicts | Date-format preference (minor) | No | No | No | No |
| P2-DEED-035-FUNC-002 | — (Phase A); Phase B needs Phase A findings | none | none | Count definitions; cash/stock correction sign-off | No | No (unless Phase B needs a correcting entry — standard finance path) | No | Yes |
| FUNC-001 | P0-SEC-002 (audit trail for approval decisions) | none | `approval_rules` consumers | Role/threshold matrix confirmation | No | No | No | Yes |

## P3 — deferred, no urgent dependencies
| Package | Depends on | Notes |
|---|---|---|
| DEED-037 | after all P1/P2 UI packages | Avoids repeated rebasing of visual changes |
| WS-I (coverage audits) | none | Verification-only, can start anytime in parallel |
| FIN-002b (numbering convention) | Decision 3 | Deliberately deferred past the functional P1-FIN-002 fix |
| DEED-025 | none | Data-quality cleanup, low urgency |

## Critical path summary
1. **Sprint 0 decisions** (parallel, non-blocking for most Sprint 1 work) →
2. **P0-FIN-001** → **P0-SEC-002** → **P1-SEC-005** (strict file-order sequence on `app/api/store/route.ts`) →
3. **P0-DEED-001** → **P1-FIN-002** → **P1-DATA-001** (strict file-order sequence on `lib/store.tsx`) →
4. **P0-SRV-001** → **P2-SRV-002-005** (infra sequence, independent of the above) →
5. Everything else in P1/P2 runs independently of the above two chains and of each other, constrained only by the `components/ui/index.tsx` / `app/globals.css` pairing (DEED-002-003 + DEED-004 + DEED-008).

No package in this backlog requires scheduled downtime. The only items requiring a human-supervised window are P0-SRV-001 (SSH switch) and the P2-SRV-002-005 PM2 user migration (brief handover only).
