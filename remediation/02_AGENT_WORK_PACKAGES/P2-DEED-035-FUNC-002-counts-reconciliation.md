# P2-DEED-035-FUNC-002 — Reconcile conflicting counts and investigate cash/stock anomalies

## 1. Task identity
- **Task ID:** P2-DEED-035-FUNC-002 · **Priority:** P2 · **Severity:** Medium
- **Assigned agent type:** ERP Functional Agent + Data/QA Agent
- **Related findings:** DEED-035 (conflicting repair/dashboard counts), FUNC-002 (negative cash, large out-of-stock) — bundled as both require the same analysis-first approach before any display or correction change
- **Business owner:** signs off on each count's definition once clarified; confirms whether negative-cash/out-of-stock figures reflect legitimate operations or require correction · **Technical reviewer:** Finance lead for the cash reconciliation

## 2. Plain-language objective
Every number shown on a screen has one clear, agreed meaning, and the same number always means the same thing wherever it appears. Any alarming-looking figure (negative cash, hundreds of items out of stock) is either explained by real transactions or corrected — nobody is left guessing whether the dashboard is broken or the business genuinely has a problem.

## 3. Confirmed problem
- **Evidence:** Product Quality Audit: repair counts of 12, 174, 198, and 3 appear across dashboard/sidebar/module screens "with no stated relationship"; a dashboard stock figure changed from 359 to 363 between reloads with no transaction behind it. Phase 1 audit: dashboard reported "Cash at Bank KSh -739,303" on two accounts, and 352 products out of stock / 416 low stock, with the audit noting these "may be legitimate operational states or symptoms of posting/valuation errors."
- **Reproduction:** compare the repair count shown on the dashboard, the sidebar badge, and the Repairs module's own header count at the same moment; separately, reload the dashboard twice in quick succession and compare the stock figure.
- **Expected:** every count has one clear business definition; the same concept shows the same number everywhere; any figure that looks like an anomaly is traced to a specific cause.
- **Root cause (counts):** likely different filter scopes (e.g. "active" vs "all-time" vs "this location") computed independently in different components without a shared source.
- **Root cause (cash/stock anomalies):** unknown — this is explicitly an analysis task, not a presumed bug; could be legitimate (e.g. genuinely negative till float pending a bank deposit) or symptomatic of a posting gap.
- **Confidence:** Medium (counts — clearly reproducible discrepancy, cause needs tracing per-instance); Low-Medium (cash/stock — needs financial/inventory reconciliation before any conclusion).

## 4. Scope
- **Phase A (analysis only, no code change):** for each conflicting count (repairs: 12/174/198/3; the fluctuating stock figure) determine the exact filter/query each display uses and document the intended business definition.
- **Phase A (analysis only):** reconcile the two negative cash-at-bank balances and the out-of-stock/low-stock counts against source documents (payments, journal entries, stock moves) to determine if they are legitimate or symptomatic.
- **Phase B (fix, after Phase A and business-owner sign-off on definitions):** make each count derive from a single shared source/query per concept; rename displays where they represent genuinely different concepts (rather than forcing them to artificially match); add an info tooltip explaining each count's definition; add tests comparing displayed counts against direct database queries.
- **Phase B (fix, only if Phase A finds a real defect):** correct any posting/valuation gap found to cause the cash or stock anomaly, via a proper reversing/correcting entry — never a silent data edit.

## 5. Out of scope
- Making every count in the app identical by definition — some counts are legitimately different concepts (e.g. "repairs awaiting parts" vs "all open repairs") and should be clearly labelled as such, not artificially unified.
- Any correction to the underlying cash/stock figures without business-owner sign-off, since a "correction" to financial data is itself a financial-control-sensitive change.

## 6. Likely affected components
- Dashboard component (`components/modules/Dashboard.tsx`)
- Sidebar badge-count logic (`components/AppShell.tsx` or a dedicated navigation component)
- Repairs module header/summary count (`components/modules/Repair.tsx` or equivalent)
- Stock/inventory summary calculations (`lib/inventory/product-filters.ts`, `lib/inventory/stock-transactions.ts`)
- Cash/bank-balance calculation (Accounting/Finance module + underlying journal-entry queries)
- New: a documented "count definitions" reference (could live in `docs/` as a short glossary) so future developers don't reintroduce drift

## 7. Implementation instructions
1. **Phase A, counts:** for each of the four repair-count instances (12, 174, 198, 3) and the fluctuating stock figure, trace the exact code path computing it (component, query, filter conditions) and write down its precise definition (e.g., "174 = all repairs with status not in [closed, cancelled]," "12 = repairs assigned to the current user awaiting action"). Compile into a short table.
2. **Phase A, cash:** pull the two negative cash-at-bank account balances' full transaction history (journal entries posted to those accounts) and reconcile against bank statements/expected float if available; determine if the negative balance reflects a real timing gap (e.g. payments recorded before a corresponding deposit) or a posting error (e.g. a payment posted to the wrong account, or twice).
3. **Phase A, stock:** pull the out-of-stock (352) and low-stock (416) counts' underlying query and cross-check a sample against actual stock-move history to confirm the counts reflect real, current inventory levels rather than a stale cache or double-counted reservation.
4. Present Phase A's findings to the business owner: which counts are genuinely different concepts (recommend renaming + tooltip) and whether the cash/stock figures need correction or are confirmed legitimate.
5. **Phase B, counts:** for genuinely-should-match counts found to differ due to a bug (not a definitional difference), consolidate to one shared query/hook; for genuinely-different concepts, rename each display to be unambiguous (e.g. "Repairs — My Queue (12)" vs "Repairs — All Open (174)") and add an info tooltip with the one-line definition from step 1's table.
6. **Phase B, anomalies:** if Phase A finds a real posting/valuation defect, correct it via a reversing/correcting journal entry (never a silent balance edit) with full audit trail, following the same discipline as P0-FIN-001's correction-only philosophy.

## 8. Acceptance criteria
- Every count's business definition is documented and available to the team (short glossary).
- Counts that are the same concept show the same number everywhere; counts that are different concepts are clearly and distinctly labelled.
- Each negative cash balance and each out-of-stock/low-stock figure is either explained by a valid source document or corrected via a proper reversing entry with audit trail.
- An info tooltip is present on ambiguous counts explaining their definition.

## 9. Test plan
- **Reconciliation queries:** SQL/script comparing each displayed count against a direct database query for the documented definition.
- **Unit:** shared count-computation hook/query, once consolidated where appropriate.
- **Manual UAT:** business owner reviews the Phase A findings document and confirms each definition and any needed correction.

## 10. Evidence required from the implementing agent
Phase A findings document (count definitions table; cash/stock reconciliation report) — this is a required deliverable in its own right; Phase B code changes (if any) with before/after screenshots; test commands + results; build result; risks; rollback; unresolved issues (e.g. any count whose exact intended definition remains unclear even after tracing the code, flagged for business-owner clarification).

## 11. Deployment plan
- **Branch:** `cursor/deed-035-func-002-counts-ddc8` (Phase B only — Phase A is analysis, delivered as a document, not a deploy)
- **Staging:** deploy Phase B changes; verify counts against staging data reconciliation queries.
- **Migrations/env:** none unless a correcting journal entry requires the standard finance posting path (no schema change).
- **Smoke test:** view the previously-conflicting counts on staging; confirm they now match their documented definitions or are clearly relabelled.
- **Human gate:** business-owner sign-off on Phase A's findings before any Phase B display or financial correction ships.
- **Rollback trigger:** any renamed/relabelled count causing user confusion reported post-deploy → revisit labelling with the business owner.
