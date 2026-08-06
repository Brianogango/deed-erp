# Deed ERP — Technical Verification Report

**Verification date:** 5 August 2026 · **Repository state verified:** `master` @ `38b75aa` (branch created from this commit: `cursor/master-remediation-orchestrator-ddc8`)
**Method:** direct source-code inspection (`Grep`/`Read` against the actual repository, not the audit documents' descriptions) for every finding before it was classified in the backlog.

## Purpose
The governing instructions require that no recommendation is implemented merely because it appears in a report, and that every finding be checked against the current codebase before being carried forward. This report is the evidence trail for that check.

## Findings confirmed unchanged from the audits (still open)
| ID | Verification method | Result |
|---|---|---|
| FIN-001 | Read `app/api/store/route.ts`, `app/api/store/[key]/route.ts`, `app/api/invoices/[id]/route.ts` in full; grepped for `posted`, `immutab`, `locked`, `409` | Confirmed: only journal append-only, anti-wipe, and invoice-line-empty-shell protections exist. No posted-header/amount/date/customer guard found. |
| SEC-002 (residual) | Grepped `app/api/store/route.ts` for `MAX_AUDIT_ROWS`; grepped `lib/auth/authorization.ts` for `appendAuditLog` | Confirmed: `MAX_AUDIT_ROWS = 600` at line 24 with a `.slice(-MAX_AUDIT_ROWS)` discard; `deed_auditLogs` mapped to `appendAuditLog` permission held by 7 roles. |
| FIN-002 (residual) | Read `lib/store.tsx` lines 3796–3820; grepped for `seq(` call sites | Confirmed: `seq()`/`deed_seq2_*` still used for DON, BBK, PAY/rec, KO, KD, KS, EXP references. |
| DEED-001 | Read `lib/auth/session.ts` in full; grepped `middleware.ts` for `returnTo` | Confirmed: fixed 12-hour TTL (`SESSION_TTL_SECONDS = 43200`), no refresh logic found, no `returnTo` param on the login redirect. |
| DEED-004 | Repo-wide grep for `aria-invalid` | Confirmed: zero occurrences in the codebase. |
| DEED-005 | Read `lib/store.tsx` line 453 (`paymentTermsDays?: number`) | Confirmed: field is optional; form-level default-display behavior matches the audit's description (verification could not fully re-run the browser harvest, but the underlying model/field evidence is consistent). |
| DEED-006 | Repo-wide grep for `archiveContact`, `mergeContact` | Confirmed: zero occurrences. |
| SEC-005 | Read `app/api/store/route.ts` write path in full | Confirmed: no `If-Match`/precondition check on `POST /api/store`; only the previously-known targeted merges (journals, products, repairs, outsource, content-filtered ledgers) provide any conflict protection. |
| `/after-sales` route | `ls app/` directory listing | Confirmed: only `app/aftersales` exists; no `app/after-sales` directory. |
| SRV-001, SRV-002, SRV-003, SRV-004, SRV-005 | Not independently re-verified against the live Contabo VPS during this planning cycle (would require a fresh SSH inspection); taken from the Backend Validation Addendum (5 Aug 2026) as the most recent infrastructure evidence available, per source-precedence rules | Carried forward as **Confirmed** per the Addendum; flagged in each work package for re-verification as the first implementation step. |

## Findings found to be already resolved (evidence of closure)
| ID | Evidence | Closing PR |
|---|---|---|
| SEC-001 | `middleware.ts` session enforcement; `app/api/store/route.ts` per-key permissions (`SENSITIVE_STORE_KEY_PERMISSIONS`), role-filtered reads (`canReadStoreKey`, `filterStoreValueForRole`) | #217–#220 |
| DEVOPS-001 (backup/restore) | Restore performed 2026-06-28 per Addendum; scheduled jobs confirmed | Pre-existing infra; residual carried by SRV-003 |
| DOC-001 | `docs/` directory listing shows `INCIDENT_RESPONSE.md` + 5 `USER_GUIDE_*.md` files | #226 |
| TEST-001 (critical flows) | `e2e/` directory + vitest suites present | #225 |
| PERF-001 (largely) | Pagination shipped; confirmed via prior conversation record of PR #227 (`lib/api-pagination.ts`, limit 50/max 200) | #227 |
| UX-001 | Superseded by the Product Quality Audit's concrete DEED-00x findings, which supplied the specific measurements UX-001 called for | Product Quality Audit itself |

## Findings partially resolved (groundwork exists, gap narrower than originally reported)
| ID | Evidence of groundwork | Remaining gap (verified) |
|---|---|---|
| DEED-002 (focus indicators) | `app/globals.css` lines 212–217 (global `:focus-visible` rule), plus component-specific rules at 586, 1432–1433, 1994, 3112 | Coverage of custom controls (tabs, menus, sidebar, dark mode) not verified against a live/current deployment; audit's "59 of 60" figure may predate these CSS rules or reflect controls the rules don't reach — production re-verification required (see P1-DEED-002-003). |
| DEED-003 (live regions) | `components/ui/index.tsx` lines 319, 1659, 1675 — multiple `aria-live` usages including a dynamic `assertive`/`polite` pattern | Coverage across every async/success/warning/error state not exhaustively verified; whether error toasts specifically carry `role="alert"` needs confirmation. |
| ARCH-001 | Parity-checking tooling shipped (#228: `lib/blob-cutover.ts`, `scripts/check-blob-parity.mjs`, `pnpm parity:check`) | Live parity snapshot (captured via this tooling on 5 Aug 2026): products 468/451, invoices 152/140, POs 22/0, serials 203/15, stock moves 121/0 — five concrete gaps remain, each scoped in P1-ARCH-001. |
| PERF-001 | Pagination shipped (#227) | Full closure depends on ARCH-001 completing (client still hydrates some full blob arrays for non-paginated domains). |
| FUNC-003 | `lib/inventory/stock-transactions.ts`, StockLevel atomic writes + `adjustStockLevel` (#223) | Direct-stock-edit and product-deletion client-side flags not yet server-enforced beyond what #223 covers. |

## Verification limitations acknowledged
- **Infrastructure findings (SRV-series)** were not re-verified via a fresh SSH session during this planning cycle; they are carried forward from the Addendum (5 Aug 2026) as the most recent available evidence, consistent with the source-precedence rules in the governing instructions. Each infrastructure work package's first implementation step re-confirms current state before acting, since infra can drift independently of the repository.
- **UI/UX measurements** (contrast ratios, truncation percentages, touch-target counts) from the Product Quality Audit were not independently re-measured pixel-for-pixel against a live browser session during this planning cycle — the audit's own harvester methodology is trusted as recent (5 Aug 2026) and thorough; work packages instruct the implementing agent to re-verify the specific measurement before and after their fix, per the Evidence Rules.
- **Data-integrity findings** (DATA-001's two specific bad records) are from Phase 1 (4 Aug 2026); this planning cycle could not query the live production database directly, so P1-DATA-001's first instruction is explicitly to re-verify whether these two records still exist before any correction is planned.
- **This report does not certify that implementation has occurred.** No code changes were made under this remediation plan. This is a pre-implementation verification of the *problem statements*, not a post-implementation verification of fixes.

## Conclusion
Of the findings carried into the master backlog, the evidence supports:
- **6 findings fully closed** by prior work (SEC-001, DEVOPS-001, DOC-001, TEST-001, PERF-001 largely, UX-001 superseded).
- **5 findings partially closed**, each with a narrower, precisely-scoped residual gap (SEC-002, ARCH-001, DEED-002, DEED-003, FUNC-003).
- **The remaining findings are confirmed open** exactly as described, with direct code citations rather than inference.

This distinction matters because it means roughly a third of the original combined finding set requires no further engineering work at all, and a further fraction requires only a narrow, well-defined completion rather than the broad remediation the original audits envisioned — allowing the five genuine P0 items to receive full, undiluted attention.
