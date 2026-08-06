# P1-ARCH-001 — Continue the blob→domain cutover (products, invoices, POs, serials, stock moves)

## 1. Task identity
- **Task ID:** P1-ARCH-001 · **Priority:** P1 · **Severity:** High
- **Assigned agent type:** Backend Agent + Database Agent
- **Related findings:** ARCH-001 (Phase 1 + Addendum, in progress)
- **Business owner:** Director informed of each cutover certificate (no per-slice approval required unless a hard-stop gap is found) · **Technical reviewer:** Tech lead + Database review per module

## 2. Plain-language objective
Finish moving the last few pieces of business data (product catalogue accuracy, invoice records, purchase orders, device serial numbers, stock movements) fully onto the proper database, one module at a time, checking the numbers match before and after each move — never all at once.

## 3. Confirmed problem
- **Evidence (Contabo parity snapshot, 5 Aug 2026, captured via `pnpm parity:check` tooling shipped in PR #228):**

| Domain | Blob count | Prisma count | Gap |
|---|---|---|---|
| products | 468 | 451 | 17 (hard-stop per `blob-cutover.ts` catalog rule) |
| invoices | 152 | 140 | 12 |
| sale_orders/quotes | 147/50 | match | — |
| repairs | 198 | 200 | (Prisma slightly ahead — acceptable) |
| serials | 203 | 15 | 188 (blob remains SoT) |
| stock moves | 121 | 0 | 121 (blob remains SoT) |
| purchase orders | 22 | 0 | 22 (blob remains SoT) |

- **Root cause:** staged migration in progress by design; several domains have no Prisma backfill/dual-write yet.
- **Confidence:** High (measured via shipped parity tooling, not inference).

## 4. Scope
This package covers the next five slices, each independently deployable and independently reversible:
1. **Products catalog reconciliation** (468 vs 451) — identify and resolve the 17-product gap (likely legacy/inactive/duplicate rows never migrated).
2. **Invoices dual-write reconciliation** (152 vs 140) — identify the 12-invoice gap.
3. **Purchase-order backfill + dual-write + cutover** (22 vs 0).
4. **Serials backfill + dual-write + cutover** (203 vs 15).
5. **Stock-moves backfill + dual-write + cutover** (121 vs 0).

Each slice: backfill script → dual-write (both paths active) → parity certification → disable legacy write for that domain only after certification.

## 5. Out of scope
- Any domain not listed above (already certified or not yet in scope).
- Changing the parity-checking tooling itself (`lib/blob-cutover.ts`, `scripts/check-blob-parity.mjs`) beyond what's needed to add the new domain mappings.
- UI changes beyond what's strictly required for a domain to read from Prisma instead of blob.
- Running more than one slice's legacy-write-disable in the same deploy.

## 6. Likely affected components
- `lib/blob-cutover.ts`, `lib/blob-cutover.server.ts` (add/adjust domain mappings for POs, serials, stock moves)
- `app/api/admin/blob-cutover/route.ts`
- `scripts/check-blob-parity.mjs`
- Relevant Prisma models: `Product`, `Invoice`, `PurchaseOrder`, `SerialNumber`, `StockMovement` (confirm exact model names in `prisma/schema.prisma`)
- Relevant domain API routes for each entity (`app/api/purchase-orders/`, `app/api/serials/` or equivalent, `app/api/stock-moves/` or equivalent)
- `docs/BLOB_PRISMA_PARITY.md` (update per certified module)
- New backfill scripts per domain under `scripts/`

## 7. Implementation instructions
1. For **products**: query both blob and Prisma product lists; diff by SKU/id/name to find the 17 missing rows. Determine whether they are legitimately inactive/archived (in which case the catalog hard-stop rule in `blob-cutover.ts:233` may need those rows explicitly backfilled as inactive, not excluded) or genuinely orphaned. Backfill the missing rows with a reviewed script (dry-run report first, then apply with backup). Re-run `pnpm parity:check`; the products domain must show zero gap before it is considered certified (it already has `hardStopWhenUnequal` semantics — do not relax that rule, close the gap instead).
2. For **invoices**: same diff approach for the 12-invoice gap; these are dual-write already, so investigate whether the gap is from before dual-write went live (historical) or an ongoing write-path bug (if the latter, treat as a P0 and escalate — do not silently patch data while a live bug persists).
3. For **purchase orders**: write a one-time backfill importing all 22 blob POs into the Prisma `PurchaseOrder` model (and line items) with careful id/reference preservation. Add dual-write to the PO creation/update API routes. Run `parity:check` until it reports zero gap and zero blob-SoT lag for POs. Only then flip the PO domain role from `blob_sot` to `dual_write` (or fully cut over) in `blob-cutover.ts`, and only then stop legacy blob writes for POs specifically.
4. For **serials**: same pattern — backfill 188 missing serial records, add dual-write to serial-issuing code paths (repair intake, stock receipt, sale), certify, cutover.
5. For **stock moves**: same pattern — backfill 121 records, add dual-write to every code path that records a stock movement (receipts, sales, transfers, adjustments, repair parts consumption — there are several call sites; enumerate them via grep for `stockMoves` before starting so none are missed), certify, cutover.
6. After each slice's certification, issue a `BlobCutoverCertificate` row (the model already exists — use it) recording the module, timestamp, and pre/post parity numbers.
7. Deploy slices independently — never combine two domains' legacy-write-disable in one deploy, so a problem in one is trivially isolated and reversible.

## 8. Acceptance criteria
- `pnpm parity:check` reports zero hard-stop gaps for products and invoices.
- Purchase orders, serials, and stock moves each reach zero blob-vs-Prisma count gap and zero blob-SoT lag, and receive a `BlobCutoverCertificate`.
- Financial totals (PO values, stock valuation) reconcile before/after each cutover.
- Each certified domain's legacy blob write is disabled only after its certificate is issued; rollback path is documented per domain.

## 9. Test plan
- **Parity check:** automated `pnpm parity:check` run per slice, before and after.
- **Reconciliation:** SQL queries comparing counts and sum totals pre/post backfill.
- **Regression E2E:** existing purchase, repair, and inventory E2E flows (from PR #225) must remain green after each cutover.
- **Manual UAT:** create a new PO/serial/stock-move post-cutover; confirm it appears correctly in both the UI and a direct Prisma query, with no blob-side duplicate.

## 10. Evidence required from the implementing agent
Per slice: backfill script + dry-run report; before/after parity numbers; `BlobCutoverCertificate` record; test results; build result; rollback procedure (re-enable blob authority for that domain, certificate marked revoked); unresolved issues.

## 11. Deployment plan
- **Branches:** one per slice, e.g. `cursor/arch-001-products-reconcile-ddc8`, `cursor/arch-001-po-cutover-ddc8`, etc.
- **Staging:** run full backfill + dual-write + parity check on staging before any production slice.
- **Migration order:** backfill must complete and be verified before dual-write is enabled; dual-write must run and be verified before legacy-write is disabled. Never skip a stage.
- **Smoke test:** per slice, create/edit/read a record of that domain through the UI post-cutover.
- **Human gate:** Director informed of each certificate; no additional sign-off required unless a hard-stop gap is discovered (in which case escalate before proceeding).
- **Rollback trigger:** any parity check regression after cutover → re-enable the domain's blob write path immediately, investigate before retrying.
