# Finance & sales seal controls (Phases A–C)

Hybrid model (Admin Officer rights retained with limits):

| Action | Roles |
|---|---|
| Validate GRN | director, admin_officer, inventory_officer |
| SO → draft invoice | director, finance_officer, admin_officer |
| Confirm/post draft customer invoice (Sales or Finance) | director, finance_officer, admin_officer **≤ `accAdminOfficerInvoiceLimitKes` (default 1,000,000)** |
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
