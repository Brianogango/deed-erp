# P1-FIN-002 — Migrate remaining document refs off client-side counters

## 1. Task identity
- **Task ID:** P1-FIN-002 · **Priority:** P1 · **Severity:** Medium
- **Assigned agent type:** Backend Agent
- **Related findings:** FIN-002 (Addendum residual)
- **Business owner:** n/a for this package (numbering *convention* standardisation is a separate deferred P3 item, Decision 3) · **Technical reviewer:** Tech lead

## 2. Plain-language objective
Every document reference the system hands out — not just invoices and quotes, but delivery notes, buy-backs, receipts, Kilimall orders/dispatches/settlements and expenses — is issued by the server, so two devices can never produce the same number.

## 3. Confirmed problem
- **Evidence (verified 5 Aug 2026):** `lib/store.tsx:3796-3804` defines `seq(prefix, key)` which reads/writes `localStorage` key `deed_seq2_${key}` and is still called for `DON` (delivery note), `BBK` (buy-back), `PAY`/`rec` (receipt), `KO`/`KD`/`KS` (Kilimall orders/dispatches/settlements), and `EXP` (expense) references (grep hits at lines 5411, 5453, 6095, 6252, 6285, 6332, 6582 and others). Commercial documents (quote/SO/invoice/PO/etc.) already use the server-derived `docSeq`/`/api/doc-numbers` path.
- **Reproduction:** create a delivery note or expense on two different browsers/devices logged in as different users at the same server-side "next number" — both can independently increment their own `localStorage` counter and produce a duplicate reference.
- **Expected:** all document references are allocated by `POST /api/doc-numbers` (or an extension of it for these kinds).
- **Root cause:** the server numbering endpoint was built for the commercial documents named in the Addendum ("11 document kinds"); these auxiliary refs were never migrated.
- **Confidence:** High.

## 4. Scope
- Add any missing document kinds to `/api/doc-numbers` (`don`, `bbk`, `rec`, `ko`, `kd`, `ks`, `exp` or their existing internal names).
- Replace each `seq('DON', 'don')`-style call site in `lib/store.tsx` with a call to the server numbering endpoint.
- Seed server sequence starting values from the current max reference of each kind already in the database, so no collision occurs on cutover.
- Concurrency tests.

## 5. Out of scope
- Changing the reference *format* (e.g. `DON/0012` vs `DON/2026/0012`) — that is the deferred numbering-convention standardisation (P3, Decision 3). This package only changes *where* the number comes from, not its shape.
- Any change to the already-server-side commercial-document numbering.
- Retroactively renumbering any existing document.

## 6. Likely affected components
- `app/api/doc-numbers/route.ts`
- `lib/doc-ref-counter.ts` (or equivalent — confirm exact helper name during implementation)
- `lib/store.tsx` (each `seq()` call site listed above)
- New/extended: `__tests__/doc-numbers-concurrency.test.ts`

## 7. Implementation instructions
1. Read `app/api/doc-numbers/route.ts` and its counter helper in full to understand the existing atomic-allocation pattern (likely a DB-transaction increment) before adding kinds.
2. For each of the seven `seq()` call sites, add the corresponding kind to the server endpoint's accepted kind list if not already present, with the seed value computed as `MAX(existing numeric suffix) + 1` for that kind, queried once during migration (not on every call).
3. Replace each call site: change from synchronous `seq('DON', 'don')` to an awaited call to the doc-numbers endpoint, threading the `async`/`await` through the enclosing function (identify and preserve the existing error-handling/toast pattern used by the already-migrated `docSeq` call sites as the template).
4. Leave the `seq()` function itself in place but mark it deprecated in a comment; do not delete it yet (other legacy code paths may reference it — confirm via a full repo grep for `seq(` before removing anything, and do not remove in this package if any other caller remains).
5. Add concurrency tests: simulate two near-simultaneous calls for the same kind and assert distinct, sequential outputs.

## 8. Acceptance criteria
- Two concurrent creates of the same document kind never produce the same reference.
- No new document reference of any of the seven migrated kinds is generated via `localStorage` counters.
- Existing references are unchanged; no renumbering occurs.
- All previously-passing tests remain green.

## 9. Test plan
- **Unit:** each migrated call site returns a server-issued number.
- **Concurrency:** parallel requests for the same kind produce unique, sequential numbers.
- **Regression:** existing invoice/quote/SO/PO numbering tests unaffected.
- **Manual UAT:** create one document of each migrated kind; confirm the reference matches the expected next server sequence value.

## 10. Evidence required from the implementing agent
Summary of changes; exact files/line changes; test commands + results; build result; risk notes (seeding correctness); rollback (each call site reverts independently); unresolved issues (e.g. any `seq()` caller left unmigrated and why).

## 11. Deployment plan
- **Branch:** `cursor/fin-002-numbering-cutover-ddc8`
- **Staging:** seed staging sequences from staging's current max refs; verify no collision against existing staging documents.
- **Migration order:** seed server sequence values **before** deploying the code that stops using `localStorage` counters, to avoid a gap where neither path is authoritative.
- **Smoke test:** create one of each migrated document kind post-deploy; verify reference format and uniqueness.
- **Rollback trigger:** any seeded sequence starts below an existing reference (collision risk) → revert deploy, re-seed correctly, redeploy.
