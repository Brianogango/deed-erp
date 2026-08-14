# Admin Officer — Quick-start guide

**Role:** `admin_officer` · Process control, master data, sales documents, purchasing, and limited invoicing.

You run day-to-day commercial and ops workflows. You do **not** manage system users or the full finance vault.

---

## What you can access

| Area | Route | Typical use |
|------|-------|-------------|
| Dashboard | `/` | Work queue |
| Sales / CRM / Contacts | `/sales`, `/crm`, `/contacts` | Quotes, SOs, customers |
| Purchases / Inventory | `/purchases`, `/operations` | POs, receipts, stock |
| Delivery / After-Sales | `/delivery`, `/aftersales` | Shipments and returns |
| Deposits / Holdovers | `/deposits`, `/holdovers` | Customer deposits, holdovers |
| Reconfiguration | `/reconfiguration` | Device rebuild jobs |
| Self-service | `/hr`, `/expenses`, `/documents`, `/sops`, `/sop-documents` | Leave, expenses, docs |

**Not available by default:** Settings (user admin), full Finance module, POS, Repair workshop boards (unless granted), audit trail view.

---

## Common tasks

### 1. Maintain customers and vendors (Contacts)

1. Open **Contacts**.
2. Create or update a company/individual; mark **customer** and/or **vendor** as needed.
3. Keep phone and email accurate — portals and notifications use them.

### 2. Quote → sales order

1. **Sales** → create a quotation with lines (product or description).
2. Send to the customer (**Quotation Sent**).
3. When accepted, confirm to **Sales Order**.
4. Request Finance/Director help if you need invoice cancel/reset or bank recon.

### 3. Purchase order and GRN

1. **Purchases** → create a PO against a vendor → **confirm**.
2. Create a goods receipt (GRN) for received lines.
3. Enter qty received (and unique serials for serial-tracked items).
4. **Validate** the receipt so stock updates — Admin Officers may validate GRNs.

### 4. Post a customer invoice or vendor bill

1. Create or open a **customer** invoice linked to the SO / delivery as required, or a **vendor bill** from a received PO.
2. Post it — Admin Officers may post customer invoices and vendor bills with no amount cap.
3. Record payment on **customer** invoices. Vendor bill payment stays **Finance/Director**.

Vendor bills may be **posted** by Admin Officers. Paying vendor bills, bank reconciliation, cancelling/resetting invoices, customer credit notes, and expense reimbursement are **Finance/Director only**.

### 5. Delivery

1. **Delivery** → create a delivery from a confirmed sales order.
2. Validate / complete quantities so invoicing and stock stay aligned.

---

## Tips

- Prefer product lines with correct tax rates so Finance does not rework documents.
- Serial products: never validate a GRN until every serial is entered and unique.
- Soft-cancel draft quotes/SOs when a deal dies — do not leave stale “sale” documents open.

## Limitations

| You cannot | Escalate to |
|------------|-------------|
| Create/edit system users | Director |
| View full audit trail | Director |
| Pay vendor bills | Finance / Director |
| Bank recon / invoice cancel-reset / customer credit | Finance / Director |
| Manage payroll employees as HR admin | Director / Finance (payroll approve differs) |
