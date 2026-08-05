# Finance Officer — Quick-start guide

**Role:** `finance_officer` · Invoicing, payments, banking, tax, reconciliation, and financial reporting — plus commercial documents needed to settle customers and suppliers.

---

## What you can access

| Area | Route | Typical use |
|------|-------|-------------|
| Finance | `/finance` | Invoices, bills, payments, journals, reports |
| Sales / CRM / Contacts | `/sales`, `/crm`, `/contacts` | Quotes, SOs, customer master |
| Purchases / Inventory | `/purchases`, `/operations` | POs, stock visibility for costing |
| Kilimall / E-commerce | `/kilimall`, `/ecommerce` | Marketplace settlement context |
| Deposits / Reconfiguration | `/deposits`, `/reconfiguration` | Deposit accounting, rebuild costing |
| Dashboard | `/` | Cash and AR cues |
| Self-service | `/hr`, `/expenses`, `/documents`, … | Leave, expenses, payslips |

**Not available by default:** POS till, Repair board, Delivery write access, Settings/user admin, audit trail view, GRN **validate** (stock apply).

---

## Common tasks

### 1. Customer invoice and payment

1. From a confirmed sales order (and validated delivery when required), create a **draft** invoice.
2. Review lines, tax, and addresses → **post** (document status becomes approved/posted).
3. **Record payment** (amount, method, reference). Payment progress is driven by amount paid — status stays a document state.
4. Blocked invoices cannot be paid until unblocked.

### 2. Vendor bill and supplier payment

1. Open or create a **vendor bill** from purchasing / Finance.
2. Post the bill.
3. Record supplier payment (Director or Finance only — Admin Officers cannot).

### 3. Bank and cash reconciliation

1. In **Finance**, open bank / cash reconciliation.
2. Match statement lines to payments and journals.
3. Only Finance Officers and Directors may manage bank recon.

### 4. Sales support (quotes and orders)

1. Create or revise quotations and sales orders when commercial terms need Finance input.
2. Confirm SOs carefully — confirmed commercial fields may lock.
3. Deep discounts may require Finance approval by policy.

### 5. Payroll approval (if used)

1. Open **HR** payroll runs when presented for approval.
2. You can approve payroll but you do **not** own full HR employee administration (`manageHR` is restricted).

---

## Tips

- Always check fiscal period locks before posting — locked periods return a conflict error.
- Prefer idempotent payment references; do not double-submit the same M-Pesa code.
- Use credit notes / proper cancellations instead of deleting posted invoices (hard delete is blocked).

## Limitations

| You cannot | Escalate to |
|------------|-------------|
| Create/deactivate system users | Director |
| View audit trail | Director |
| Validate GRN / apply receipt stock | Director, Admin Officer, Inventory Officer |
| Write deliveries | roles with `manageDeliveries` |
| Operate POS / Repair modules (unless granted) | Director for module grant |
| Break every SoD rule without director break-glass | Director |

See also [Finance & sales seals](./FINANCE_SALES_SEALS.md).
