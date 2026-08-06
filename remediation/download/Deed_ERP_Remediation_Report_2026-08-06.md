# Deed ERP — Remediation Report (Owner Pack)

**Generated:** 2026-08-06 07:35 UTC  
**Audience:** Business owner / decision-maker  
**Code base verified:** `master` @ `38b75aa` (plus open PRs noted below)  
**Planning PR:** [#231](https://github.com/Brianogango/deed-erp/pull/231) — full backlog & agent packages  
**First fix PR:** [#232](https://github.com/Brianogango/deed-erp/pull/232) — FIN-001 posted invoice immutability (**draft, not merged/deployed**)

---

## How to use this pack

| File | What it is |
|------|------------|
| **This report** (`Deed_ERP_Remediation_Report_*.md` / `.html`) | Single narrative to read end-to-end |
| `Deed_ERP_Remediation_Full_Pack_*.zip` | Complete planning folder (`remediation/`) for deeper review |
| PR #231 | Living plan in GitHub |
| PR #232 | First P0 code fix awaiting your go-ahead to merge/deploy |

**Print tip:** Open the `.html` file in a browser → Print → Save as PDF.

---

## 1. Bottom line (read this first)

The live product is **not** the broken system described in the oldest Phase 1 audit. Database, auth, backups, API routes, and many security/docs/test/performance items were already fixed and deployed (PRs **#217–#228**).

What remains is a **focused remediation program**: a few true emergencies, then finance/data integrity, then UX and ops polish.

| Priority | Count (open) | Meaning |
|----------|--------------|---------|
| **P0** | 5 | Do now — money, security, or session risk |
| **P1** | ~12 packages | Next — integrity, ops, UX |
| **P2** | 3 bundles | Later — polish / nice-to-have |

**Already closed by prior work (do not re-do):** SEC-001 (password policy), DOC-001 (user guides), TEST-001 (critical E2E), PERF-001 (API pagination), much of DEVOPS/UX backlog → renamed into remaining packages.

---

## 2. Live status snapshot (updated 6 Aug 2026)

### Done in planning
- Master backlog, sprint plan, test matrix, dependency map, 7 decisions, 20 agent work packages  
- Human action report + completion/verification templates  
- All in PR **#231** (draft)

### In progress — code ready, waiting on you
| Item | Status | PR |
|------|--------|-----|
| **P0-FIN-001** Posted invoice editable on store sync | **Fixed in code**, tests green (1035), **not merged / not on Contabo** | [#232](https://github.com/Brianogango/deed-erp/pull/232) |

**What FIN-001 does:** Once an invoice is `posted`, the store sync path can no longer change lines, totals, dates, customer, currency, type, or ref. Payments (`amountPaid`) and cancel remain allowed. Rejected tampering is logged on the audit trail.

**Still open on FIN-001 (by design):** Direct Prisma invoice PATCH (`/api/invoices/[id]`) still used by *repair quote revisions* — needs a separate careful pass so we do not break that workflow. Documented as follow-up in the PR.

### Not started (need you or Contabo console)
| Item | Who |
|------|-----|
| **P0-SRV-001** Root SSH password / fail2ban | **You** on Contabo |
| **P0-SRV-003** Offsite backups + secret scrub | **You** (Decision 7) + agent |
| **P0-SEC-002** Audit row discard + legacy client audit | Agent (after FIN-001 merge order) |
| **P0-DEED-001** Session / returnTo / draft autosave | Agent (after Decision 4) |

---

## 3. Five things that need action now (P0)

### ① Finance — posted invoices were mutable (FIN-001)
- **Risk:** Someone (or a buggy client) could change a posted invoice’s money fields via store sync.  
- **Fix ready:** PR #232.  
- **Your action:** Review PR → approve merge → deploy to Contabo when ready. Prefer a quick staging “tamper” smoke test first (change a posted invoice total via store; expect rejection).

### ② Server — SSH as root with password (SRV-001)
- **Risk:** Internet-facing root password login; no fail2ban mentioned in audit posture.  
- **Your action (Contabo console / SSH):**  
  1. Create a non-root sudo user  
  2. Add SSH key; disable password auth for root (or all password auth)  
  3. Install/enable fail2ban  
  4. Confirm you can still get in via console before locking password auth  
- **Agent cannot safely do this alone** without risking lockout.

### ③ Backups — only on the same host + secrets in artifacts (SRV-003)
- **Risk:** Disk/host failure loses DB *and* backups; backup tarballs may contain secrets.  
- **Your action:** Decide offsite target (Decision 7: Contabo Object Storage / Backblaze / other). Share credentials securely. Then agent implements sync + secret scrub.

### ④ Security — audit log can drop history; old client audit writable (SEC-002)
- **Risk:** `MAX_AUDIT_ROWS = 600` discards older audit rows; legacy `deed_auditLogs` may still be client-writable.  
- **Your action:** Approve agent package after FIN-001 (same `app/api/store/route.ts` file — sequential merge).

### ⑤ Product — 12h fixed session, no return path / draft save (DEED-001)
- **Risk:** Users lose work / land on wrong page after re-login.  
- **Your action:** Answer Decision 4 (idle timeout preference). Then agent implements returnTo + draft autosave.

---

## 4. Decisions we need from you

Reply with choices (or “approve recommended”):

| # | Topic | Recommended default |
|---|--------|---------------------|
| **1** | Soft-delete vs hard-delete for business records | Soft-delete + recycle where possible |
| **2** | Who may cancel a posted invoice | Admin / finance role only |
| **3** | Diagnosis fee on portal quotes | Keep fee; show clearly on portal |
| **4** | Session idle timeout | e.g. 30–60 min idle + absolute cap (vs fixed 12h only) |
| **5** | Delivery “general” job type | Allow with required notes |
| **6** | Device reconfiguration after save | Controlled re-open with audit |
| **7** | Offsite backup provider | Pick one account we can configure |

Full wording: see `06_DECISIONS_REQUIRED.md` inside the ZIP / PR #231.

---

## 5. Sprint overview (execution order)

| Sprint | Focus | Gate |
|--------|--------|------|
| **0** | This plan + your decisions | Decisions 1–7 (or partial) |
| **1** | All **P0** (FIN/SEC/SRV/DEED) | Staging smoke + your Contabo steps |
| **2** | Finance/data integrity + store hardening | FIN/DATA packages |
| **3** | Ops / SRE / remaining SEC | Offsite backups live |
| **4** | UX / portal / device flows | Product sign-off |
| **5** | P2 polish bundles | Optional |

Dependency rule of thumb: **FIN-001 → SEC-002 → SEC-005** on the same store route file. **DEED-001** before some FIN/DATA client work on `lib/store.tsx`.

---

## 6. Already shipped (do not treat as open bugs)

Examples from recent Contabo deploys (PRs #217–#228 area):

- Password / auth hardening (SEC-001 family)  
- User guides / incident docs (DOC-001)  
- Critical E2E workflows (TEST-001)  
- API pagination (PERF-001)  
- Stock-level indexes (DB-001) + parity follow-up  
- Portal stale invoice amount fix  
- Catalog search flicker  
- Session revoke, security headers, upload magic bytes  
- Admin reset / export / store-key fixes  
- Diagnosis fee portal quote, delivery general job type, device reconfig design, etc.

If an old PDF audit still lists “no database / no auth / no backups,” **that section is obsolete** — trust live code + Backend Validation Addendum over Phase 1 on those points.

---

## 7. What “done” looks like for you

After each sprint you should get:

1. Short **human completion** note (what changed in business terms)  
2. **Technical verification** (tests, build, deploy SHA)  
3. Contabo on `master` only after merge  

Templates: `07_HUMAN_COMPLETION_REPORT.md`, `08_TECHNICAL_VERIFICATION_REPORT.md` in the ZIP.

---

## 8. Suggested next message from you

Any of these is enough to unblock:

1. **“Merge and deploy FIN-001”** — after you skim PR #232  
2. **“Decisions: approve recommended”** or numbered answers 1–7  
3. **“I finished Contabo SSH hardening”** / **“Backup account is ___”**  
4. **“Continue Sprint 1”** — next P0 packages in order  

---

## 9. Links

- Planning PR: https://github.com/Brianogango/deed-erp/pull/231  
- FIN-001 PR: https://github.com/Brianogango/deed-erp/pull/232  
- Repo: https://github.com/Brianogango/deed-erp  

---

*End of owner report. Full technical backlog and 20 agent work packages are in the accompanying ZIP.*
