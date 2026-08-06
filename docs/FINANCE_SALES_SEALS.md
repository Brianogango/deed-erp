# Finance & sales seal controls (Phases A–C)

Hybrid model (Admin Officer rights retained with limits):

| Action | Roles |
|---|---|
| Validate GRN | director, admin_officer, inventory_officer |
| SO → draft invoice | director, finance_officer, admin_officer |
| Post/pay **customer** invoice | director, finance_officer, admin_officer **≤ `accAdminOfficerInvoiceLimitKes` (default 1,000,000)** |
| Post/pay vendor bill | director, finance_officer only |
| Bank recon / cancel-reset invoice / expense reimburse / customer credit | director, finance_officer only |
| SoD (pay own post) | Required above the same threshold (director break-glass) |

## Phase A
- Sensitive store writes: `deed_saleOrders`, `deed_deliveries`, `deed_expenses`
- `deed_payments` → `recordPayment`; bank recon keys → `manageBankRecon`
- `deed_auditLogs` appendable by ops roles (`appendAuditLog`); view still director
- Approval requests writable by sales (`requestSalesApproval`)
- SO reset/delete hardened; payment API rejects draft/blocked + idempotency

## Phase B
- Append-only journal merge on `/api/store`
- Deterministic payment journal refs
- Atomic `/api/sale-orders/[id]/create-invoice`

## Phase C
- Confirmed SO commercial freeze server-side
- Deep discount approvals always include Finance
- Default `salesLockConfirmed: true`
- Reversing a confirmed Sales Order ("Set to Quotation" or "Cancel") requires director or finance_officer, both client- and server-side (`lib/odoo-sales-flow.ts` `saleTransitionError`, `lib/store.tsx` `cancelSO`/`resetSOToDraft`)

## Known gap: deep-discount/credit approval gate is currently disabled

Commit `a701411` ("Remove sales confirmation approval workflow") turned the deep-discount/backorder/credit-override
approval gate described above into a server-side no-op: `lib/sales-approval-enforcement.server.ts`'s
`enforceSaleOrderApprovals` always returns `{ ok: true }`, and no `requestSalesApproval` record is ever created for
a sale order anymore. Credit-limit checking exists only client-side (`lib/store.tsx` `getCustomerCreditStatus`),
so it can be bypassed by calling the API directly.

This is a known, accepted gap as of 2026-08 — not yet restored. If Finance needs this control back, re-enabling
`enforceSaleOrderApprovals` (and reconnecting a `requestSalesApproval` write path) is the fix; until then, treat
deep discounts and credit-limit overrides on confirmed sale orders as unenforced server-side.
