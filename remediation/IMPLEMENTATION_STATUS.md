# Remediation implementation status (2026-08-06)

Branch: `cursor/remediation-implement-all-ddc8`

## Shipped in this branch

| Package | Status |
|---------|--------|
| **P0-FIN-001** Posted invoice immutability | Done (from #232 base) |
| **P0-SEC-002** Audit archive + client-immutable `deed_auditLogs` + `/api/admin/audit` | Done |
| **P0-DEED-001** returnTo, session refresh/status, expiry warning, form drafts, logout purge | Done |
| **P0-SRV-001** SSH hardening | Scripts in `scripts/ops/` — **needs Contabo console human** |
| **P0-SRV-003** Offsite backups | Example script — **needs Decision 7 credentials** |
| **P1-DEED-007** Purchases type/status facets | Done |
| **P1-DATA-001** NaN seq guard + date bounds + cleanup script | Done |
| **P1-DEED-004** Field `error` + ARIA + repair/contact wiring | Done |
| **P1-DEED-005** Payment terms visible + cash option + review script | Done (default still 30 pending Decision 1) |
| **P1-SEC-005** Store If-Match concurrency | Done |
| **P1-DEED-008** Dark mode body/`#__next` tokens | Done |
| **P1-DEED-010** Product name `title` tooltips | Done |
| **P1-DEED-006** Contact archive/restore/merge APIs + soft-delete | Done (Director-only merge) |
| **P1-ARCH-001** Blob cutover | **Not done** — multi-slice production data work |
| **P1-FIN-002** Numbering cutover | Partial — `docSeq` already exists; full cutover deferred |
| **P1-DEED-011-012** Bulk invoice actions | Not fully done |
| **P2-*** | Ops scripts only; counts reconciliation deferred |

## Human gates still required

1. Contabo console for SRV-001 final SSH switch  
2. Offsite backup account (Decision 7)  
3. Decisions 1–5 for final policy tuning (defaults applied where safe)  
4. Merge/deploy this branch + FIN-001 to Contabo after staging smoke  

## Tests

Run: `npx vitest run __tests__/session-draft.test.ts __tests__/audit-retention.test.ts __tests__/purchases-filter-counts.test.ts __tests__/data-validation.test.ts __tests__/api-store-permissions.test.ts __tests__/store-concurrency.test.ts __tests__/field-validation-a11y.test.ts __tests__/finance-invoice.test.ts`
