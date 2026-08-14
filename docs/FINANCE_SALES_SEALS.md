# Finance & sales seal controls (Phases A–C)

Hybrid model:

| Action | Roles |
|---|---|
| Validate GRN | director, admin_officer, inventory_officer |
| SO → draft invoice | director, finance_officer, admin_officer |
| Post/pay **customer** invoice | director, finance_officer, admin_officer (no amount cap) |
| Post vendor bill | director, finance_officer, admin_officer |
| Pay vendor bill | director, finance_officer only |
| Bank recon / expense reimburse / apply customer credit | director, finance_officer only |
| Cancel / reset invoice | director, finance_officer, admin_officer |
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

## Sales confirmation gates (Phases 1+)

On quotation → sale, `/api/sale-orders/[id]` enforces:

1. **Workflow + role** — `saleTransitionError` (sales_rep / admin_officer / director).
2. **Expiry** — `assertQuoteNotExpired` rejects confirm when `validUntil` is past.
3. **Credit / overdue** — `assertSaleOrderCreditOnConfirm` blocks overdue balances and credit-limit overages unless the actor is Finance or Director.
4. **Approval thresholds** — `enforceSaleOrderApprovals` re-enabled for deep discount, credit override, special pricing, and backorder triggers (Settings rules / hardcoded fallbacks).
5. **Stock reservation** — `reserveStockForSaleOrder` runs after confirm; failure **rolls the SO back** to the prior quotation status so the order never stays confirmed without a reservation attempt.

Client `confirmSO` also checks overdue + `getCustomerCreditStatus` before calling the API (UX), but the API is authoritative.
