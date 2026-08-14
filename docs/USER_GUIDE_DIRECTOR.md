# Director — Quick-start guide

**Role:** `director` · Full operational access across Deed ERP.

Use this guide after you receive a login (or reset a password). Directors own approvals, user access, settings, and audit review.

---

## What you can access

| Area | Route | Notes |
|------|-------|--------|
| Dashboard | `/` | Cross-module snapshot |
| Sales / CRM / Contacts | `/sales`, `/crm`, `/contacts` | Quotes, orders, pipeline |
| POS | `/pos` | Till sessions and sales |
| Purchases / Inventory | `/purchases`, `/operations` | POs, GRNs, stock |
| Delivery / After-Sales | `/delivery`, `/aftersales` | Fulfilment and returns |
| Repairs / Refurb / Reconfig | `/repairs`, `/refurbishment`, `/reconfiguration` | Workshop oversight |
| Finance | `/finance` | Invoices, payments, journals, reports |
| Deposits / Holdovers / Expenses | `/deposits`, `/holdovers`, `/expenses` | Cash and cost controls |
| HR & Payroll | `/hr` | Employees, leave, payroll |
| Settings | `/settings` | Company, users, banks, module toggles |
| Audit trail | Settings / audit views | Director-only |

Self-service for every user (including you): Leave, Expenses, KPI Targets (`/sops`), Standards & SOPs (`/sop-documents`), My Documents (`/documents`).

---

## Common tasks

### 1. Create a user from HR (Settings → User Access)

1. Open **Settings** → user / access section.
2. Select an **active HR employee** (new accounts are linked to employees).
3. Choose role and modules; save.
4. The employee receives a temporary password by email and must change it on first login.

Only directors can create, edit, or deactivate system users.

### 2. Approve a sales order and invoice flow

1. **Sales** → open the quotation → mark **Quotation Sent** when emailed.
2. Confirm to **Sales Order** when the customer accepts (commercial fields may lock after confirm).
3. Ensure delivery is validated when invoicing from a confirmed SO (Odoo-style path).
4. **Finance** → post the customer invoice → record payment (M-Pesa, cash, bank, etc.).

You can post/pay any invoice amount. Admin Officers can post customer invoices and vendor bills with no amount cap; paying vendor bills stays Finance/Director.

### 3. Validate a goods receipt (GRN)

1. **Purchases** → confirm the purchase order.
2. Create / open the receipt (GRN) with received quantities (and serials if required).
3. **Validate** the receipt so stock is applied (warehouse / shop).
4. Confirm the PO shows as received.

### 4. Oversee repairs

1. **Repairs** → filter by status or technician.
2. Assign jobs, review diagnosis and quotes, approve work.
3. Confirm QC / ready, then collection / outbound release as needed.

### 5. Review audit and security posture

1. Open the audit trail (director-only).
2. After staff role or access changes, expect sessions for deactivated / re-roled users to stop working.
3. Keep SMTP, banks, and Partner API keys current in **Settings**.

---

## Tips

- Prefer confirming SOs before deep commercial edits — confirmed orders can be frozen by policy.
- Use verified backups before risky admin resets or major cutovers (ops team — see [Incident Response](./INCIDENT_RESPONSE.md)).
- DIA / AI assist may be available if the module is granted on your account.

## Limitations

- You still follow segregation-of-duties rules where configured (e.g. paying an invoice you posted above a threshold may require break-glass).
- Hard-deleting posted financial documents is blocked; use credit notes / cancellations where the system allows.
- Customer portal and track links are public — do not put secrets in repair notes that customers can see.
