# Deed ERP — Master Remediation Backlog

**Date:** 5 August 2026 · **Verified against:** repo `master` @ `38b75aa` + Contabo production inspection evidence (Addendum, 5 Aug 2026)
**Source precedence applied:** live code evidence → Backend Validation Addendum (5 Aug) → Product Quality Audit (5 Aug) → Phase 1 audit (4 Aug).

Machine-readable version: `01_MASTER_BACKLOG.json`. Work packages: `02_AGENT_WORK_PACKAGES/`.

## Reconciliation summary

- **Phase 1's superseded claims are retired.** A populated Prisma/PostgreSQL backend, server-side auth on every `/api` route, journal append-only enforcement (`lib/finance-controls.ts:129 mergeAppendOnlyJournals`), fiscal locks (`lib/fiscal-lock.server.ts`, enforced in invoices/payments/journals/sale-orders routes), server-side doc numbering (`/api/doc-numbers`), scheduled + restored backups, and a staging DB all exist. Verified in code on 5 Aug.
- **Ten remediation packages have already merged and deployed** since the audits were drafted (PRs #217–#228): fail-closed AUTH_SECRET + soft-cancel deletes, password hardening, session revocation, security headers/CORS/portal verification, admin-reset fix + fiscal-lock enforcement on finance writes, StockLevel orphan fix + indexes, upload magic-byte validation, E2E critical workflows, role user guides + incident runbook, server-side pagination, and blob/Prisma parity coverage. Findings those closed are marked **Already resolved** below with the closing PR.
- **Duplicate merges:** DEVOPS-001 ⊂ SRV-003 (offsite gap is the live residual). UX-001 ⊂ DEED-002/003/004/008/027 (the Product Quality Audit is the concrete superset). PERF-001 (blob quota) largely addressed by pagination (#227) + ongoing ARCH-001 cutover; residual tracked under ARCH-001. TEST-001 closed by #225 for critical flows; coverage gaps tracked in Workstream I. DOC-001 closed by #226 for the minimum set.

## Consolidated findings register

Status legend: ✅ Already resolved · 🔴 Confirmed (open) · 🟠 Partially confirmed / partially resolved · ⚪ Cannot reproduce w/o environment (verification step scheduled) · 🔵 Requires human decision · 🚫 Not tested (destructive).

| ID | Title | Report | Orig. sev | Current sev | Status | Evidence (verified 5 Aug) | Superseded by |
|---|---|---|---|---|---|---|---|
| ARCH-001 | Blob-first architecture / incomplete cutover | Phase 1 + Addendum | Critical | High | 🟠 In progress | Domain API + Prisma populated; 198 `deed_*` blob keys remain; parity tooling shipped (#228); Contabo parity: POs 22/0, serials 203/15, stock moves 121/0 blob/Prisma | Addendum narrows Phase 1 |
| SEC-001 | Client-only access control | Phase 1 | Critical | Low (residual) | ✅ Largely resolved | `middleware.ts` session enforcement; per-key store permissions; role-filtered reads; session revocation (#219); password hardening (#218) | Addendum refutes as stated |
| SEC-002 | Mutable/limited audit logs | Phase 1 + Addendum | Critical | High | 🟠 Residuals confirmed | `app/api/store/route.ts:24 MAX_AUDIT_ROWS = 600` rolling cap still present; legacy `deed_auditLogs` still client-authored for roles with `appendAuditLog` | — |
| FIN-001 | Posted financial records mutable | Phase 1 + Addendum | Critical | **Critical** | 🔴 Residual confirmed | Journals append-only + fiscal locks enforced ✔; invoice **number** immutable once posted ✔ (`app/api/invoices/[id]/route.ts`); **no posted-status guard on header/amount/line edits via `/api/store`** — grep of store route confirms only empty-shell line protection | — |
| FIN-002 | Client-side document numbering | Phase 1 + Addendum | High | Medium | 🟠 Partially resolved | `/api/doc-numbers` exists; commercial docs use server-derived `docSeq`; **legacy `seq()` with `deed_seq2_*` localStorage counters still mints DON/BBK/PAY/KO/KD/KS/EXP refs** (`lib/store.tsx:3796-3804`) | — |
| DATA-001 | NaN refs / impossible dates in live data | Phase 1 | High | Medium | 🟠 Open (cleanup + validation) | `RFD/0NaN` ×2 and repair date `2091-04-28` reported in production data; server date-bounds validation not found on repair intake path | — |
| SEC-003 | Sensitive data in plaintext localStorage | Phase 1 | High | Medium | 🟠 Open (narrowing via cutover) | Client still hydrates full ledgers incl. bank accounts/company settings; reduction follows ARCH-001 cutover; pagination (#227) reduced footprint | — |
| SEC-004 | Cross-user data residue after logout | Phase 1 | High | Medium | ⚪ Needs re-verify | Logout purge not located in code; verify then fix in DEED-001 package (shared session/teardown surface) | — |
| PERF-001 | Blob sizes vs localStorage quota | Phase 1 | High | Medium | 🟠 Largely resolved | Server pagination shipped (#227); repairs blob ~0.5 MB; full closure via ARCH-001 | #227 |
| FUNC-001 | Approvals/thresholds client-side | Phase 1 | High | Medium | 🟠 Open | `approval_rules` table + `reconfiguration_approvals` exist server-side; sales/finance approval thresholds still client-evaluated; deferred from earlier packages | — |
| FUNC-002 | Negative cash / stock-out anomalies | Phase 1 | Medium | Medium | ⚪ Analysis task | Reconciliation not yet performed | — |
| FUNC-003 | Inventory controls client-side | Phase 1 | Medium | Low-Med | 🟠 Partially resolved | Stock transactions server path (`lib/inventory/stock-transactions.ts`), StockLevel atomic + `adjustStockLevel` (#223); direct-edit flags still client-side | #223 narrows |
| DEVOPS-001 | Backup/DR unverified | Phase 1 | High | — | ✅ Superseded | Backups verified + restore performed (Addendum) | **SRV-003** carries residual |
| DOC-001 | No documentation | Phase 1 | Low | — | ✅ Resolved | `docs/` incl. runbooks + 5 role guides (#226) | #226 |
| TEST-001 | No automated tests | Phase 1 | Low | — | ✅ Resolved (critical flows) | vitest suites + Playwright E2E (#225); coverage gaps → Workstream I | #225 |
| UX-001 | A11y/mobile unverified | Phase 1 | Medium | — | ✅ Superseded | Product Quality Audit measured concretely | DEED-00x series |
| SRV-001 | Root password SSH, no brute-force protection | Addendum | High | **High** | 🔴 Confirmed | `PermitRootLogin yes`, `PasswordAuthentication yes`, no fail2ban; root password shared in plaintext | — |
| SRV-002 | App + PM2 run as root | Addendum | Medium | Medium | 🔴 Confirmed | pm2-root.service, both instances user=root (verified on Contabo during deploys) | — |
| SRV-003 | Backups host-local; secrets in artifacts | Addendum | High | **High** | 🔴 Confirmed | `/usr/local/bin/deed_erp_backup.sh` hardcodes DB pass, copies `.env`; no offsite step | — |
| SRV-004 | Stale ufw rule 3001/tcp | Addendum | Low | Low | 🔴 Confirmed | ufw allows 3001, no listener | — |
| SRV-005 | PM2 restart churn; no monitoring | Addendum | Medium | Medium | 🟠 Confirmed (partly explained) | 123–124 restarts consistent with frequent deploys (each deploy = PM2 reload); pg FATAL on reload; no monitoring stack | — |
| DEED-001 | Silent session loss destroys unsaved work | PQ Audit | Critical | **Critical** | 🔴 Confirmed | `SESSION_TTL_SECONDS = 43200` (12 h), no refresh, no expiry warning, no draft autosave, no return-to-route (verified `lib/auth/session.ts`, `middleware.ts`) | — |
| DEED-002 | No visible focus indicators (59/60) | PQ Audit | Critical | Medium | 🟠 Partially resolved | Global `:focus-visible` rules exist (`app/globals.css:212-217` + component-level); audit may predate deploy or coverage incomplete — production verification required | — |
| DEED-003 | Zero `aria-live` regions | PQ Audit | Critical | Medium | 🟠 Partially resolved | Toast has `aria-live` (`components/ui/index.tsx:319,1659,1675`); coverage across async states unverified in prod | — |
| DEED-004 | Validation not bound to fields | PQ Audit | High | High | 🔴 Confirmed | No `aria-invalid`/`aria-describedby` pattern in form components; toast-only errors | — |
| DEED-005 | Hidden 30-day payment terms | PQ Audit | High | High | 🔵 Confirmed + decision needed | `paymentTermsDays` optional in model; contact form placeholder default per audit; owner must set default policy | — |
| DEED-006 | No contact archive/merge/delete | PQ Audit | High | High | 🔴 Confirmed | No `archiveContact`/`mergeContact` anywhere in repo | — |
| DEED-007 | Purchases filter "POs (0)" vs 22 POs | PQ Audit | High | High | 🔴 Confirmed | Type/status conflated in Purchases facet counts | — |
| DEED-008 | Dark mode broken (contrast 1.86:1) | PQ Audit | High | High | 🔴 Confirmed | `[data-theme='dark']` tokens exist but body/status-pill coverage incomplete per measurements | — |
| DEED-009 | Dashboard trends cards clip at 1366px | PQ Audit | High | Medium | 🔴 Confirmed | 54–62% of title hidden on 4 cards | — |
| DEED-010 | Product names truncated ≤80% | PQ Audit | High | High | 🔴 Confirmed | 63 truncations across 6 modules; no tooltips | — |
| DEED-011/012 | "Pay 0 invoices" enabled; duplicate counts/Clear | PQ Audit | High | Medium | 🔴 Confirmed | Bulk bar renders both duplicates and zero-payable enabled button | — |
| DEED-013…041 (quick wins) | SOPs message, ⌘K hint, date mask, More menu, dup date, `/after-sales` 404, `transition:all`, date formats, HR icon labels, 4 unlabelled inputs, success-green contrast, duplicate h1, touch targets | PQ Audit | Med/Low | Med/Low | 🔴 Confirmed (bundle) | `/after-sales` dir absent (only `aftersales`) verified; rest per audit measurements | — |
| DEED-035 | Conflicting repair/dashboard counts | PQ Audit | Medium | Medium | 🔴 Confirmed | 12/174/198/3 across screens without definitions | — |
| DEED-037 | Design-token sprawl (73 button styles, 27 font sizes) | PQ Audit | Medium | Low (planned) | 🔴 Confirmed | Consistency counts from CSSOM harvest | — |
| SEC-005 | No optimistic concurrency on store writes | Phase 1 + Addendum | Medium | Medium | 🔴 Confirmed (narrowed) | `POST /api/store` has no If-Match; targeted merges only for journals/products/repairs/outsource | — |
| PERF-DUP | Duplicate `/store` requests per route | PQ Audit | Low | Low | 🟠 Open | 2–3× fetches per route; SSE merge fix (#230) reduced churn, dedup not yet implemented | — |

## Prioritised backlog

### P0 — Immediate business/production risk
| # | ID | Title | Agent | Human decision? | Work package |
|---|---|---|---|---|---|
| 1 | FIN-001 | Posted-invoice immutability on every write path | Backend | Sign-off on correction workflow | `P0-FIN-001-posted-invoice-immutability.md` |
| 2 | SRV-001 | SSH hardening + root credential rotation | DevOps (+human on console) | Maintenance window (§7.6) | `P0-SRV-001-ssh-hardening.md` |
| 3 | SRV-003 | Off-site encrypted backups; secrets out of artifacts | DevOps | Storage destination (§7.7) | `P0-SRV-003-offsite-backups.md` |
| 4 | SEC-002 | Audit retention (kill 600-row cap) + server-only authorship | Backend/Security | Retention duration (§7.5) | `P0-SEC-002-audit-retention.md` |
| 5 | DEED-001 | Session stability + draft autosave (+ SEC-004 logout purge) | Frontend | Timeout policy (§7.4) | `P0-DEED-001-session-stability.md` |

### P1 — High-impact operational
| # | ID | Title | Agent | Work package |
|---|---|---|---|---|
| 6 | FIN-002 | Deprecate legacy client counters; server numbering everywhere | Backend | `P1-FIN-002-numbering-cutover.md` |
| 7 | ARCH-001 | Blob→domain cutover: reconcile products/invoices; PO/serials/stock-move cutovers | Backend/DB | `P1-ARCH-001-blob-cutover.md` |
| 8 | SEC-005 | Optimistic concurrency on `/api/store` writes | Backend | `P1-SEC-005-concurrency.md` |
| 9 | DEED-004 | Field-bound validation pattern (all forms) | Frontend/A11y | `P1-DEED-004-field-validation.md` |
| 10 | DEED-002/003 | Verify+complete focus indicators & live regions | Frontend/A11y | `P1-DEED-002-003-a11y-foundations.md` |
| 11 | DEED-005 | Payment-terms disclosure + backfill review | Frontend+Backend | `P1-DEED-005-payment-terms.md` |
| 12 | DEED-006 | Contact archive/restore/merge | Full-stack | `P1-DEED-006-contact-archive-merge.md` |
| 13 | DEED-007 | Purchases type-vs-status facets | Frontend | `P1-DEED-007-purchases-filters.md` |
| 14 | DEED-008 | Dark-mode token completion | Frontend | `P1-DEED-008-dark-mode.md` |
| 15 | DEED-010 | Product-name columns + tooltips | Frontend | `P1-DEED-010-product-truncation.md` |
| 16 | DEED-011/012 | Invoice bulk-action bar fixes | Frontend | `P1-DEED-011-012-bulk-actions.md` |
| 17 | DATA-001 | Date/ref validation + cleanup of NaN refs and 2091 date | Backend/DB | `P1-DATA-001-data-cleanup.md` |

### P2 — Important quality/consistency
| ID | Title | Notes |
|---|---|---|
| SRV-002 + SRV-005 | Dedicated service user; PM2 restart investigation; monitoring | One infra package; after SRV-001 |
| DEED-009 | Dashboard trends card wrap at 1366px | |
| DEED-035 + FUNC-002 | Count reconciliation + definitions + cash/stock anomaly analysis | Analysis first, rename/tooltip after |
| DEED-QW bundle | Quick wins: SOPs msg, ⌘K hint, date mask, More menu, dup date, `/after-sales` redirect, `transition:all`, date-format standard, HR icon labels, 4 inputs, success-green contrast, duplicate h1 | Single bundle package `P2-DEED-QW-quick-wins.md` |
| DEED-027 | Touch-target sizing pass | Shared components first |
| PERF-DUP | `/store` request deduplication | With SEC-005 (same surface) |
| FUNC-001 | Server-side approval thresholds | Deferred from BE-002; needs role matrix decision |
| FUNC-003 | Server-enforced direct-stock-edit/product-deletion flags | Narrow residual |
| SEC-003 | Sensitive-data client-cache minimisation | Follows ARCH-001 |
| SRV-004 | Remove ufw 3001 rule | One-liner during SRV-001 window |

### P3 — Planned maturity
| ID | Title |
|---|---|
| DEED-037 | Design-token + Button consolidation, visual-regression suite |
| WS-I | Role coverage audits (7 roles), mobile 360/390/768/1024/1366/1440, NVDA/VoiceOver, CSV import, exports, POS checkout, payments, JARVIS, portals |
| FIN-002b | Document-numbering convention standardisation (needs decision §7.3) |
| DEED-025 | Phone validation + name normalisation + contact data cleanup |

Full per-item detail (root cause, acceptance criteria, tests, deployment/rollback notes) lives in the JSON and in each work package.
