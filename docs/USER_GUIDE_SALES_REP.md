# Sales Rep — Quick-start guide

**Role:** `sales_rep` · CRM, quotations, sales orders, and customer records. You do **not** purchase stock or post invoices.

---

## What you can access

| Area | Route | Typical use |
|------|-------|-------------|
| Dashboard | `/` | Your pipeline snapshot |
| Sales | `/sales` | Quotations and sales orders (**your** records) |
| CRM | `/crm` | Leads / opportunities you own |
| Contacts | `/contacts` | Customer records |
| Delivery | `/delivery` | Follow fulfilment status |
| After-Sales / Holdovers | `/aftersales`, `/holdovers` | Returns and holdovers |
| Reconfiguration | `/reconfiguration` | Sales-driven rebuild requests |
| Self-service | `/hr`, `/expenses`, `/documents`, `/sops`, `/sop-documents` | Leave, expenses, docs |

**Not available by default:** Purchases, Inventory stock edits, Finance, POS, Settings.

Row-level access: you typically see **your own** sale orders and opportunities, and a **customer-invoice slice** (not vendor bills).

---

## Common tasks

### 1. Create and send a quotation

1. Open **Sales** → new quotation.
2. Select customer (or create via **Contacts** first).
3. Add lines with qty, unit price, and tax.
4. Save → mark **Quotation Sent** when the quote is emailed to the customer.
5. When the customer accepts, move toward confirmation (or ask Admin/Finance to confirm if your workflow requires it).

Quotes must have a total of at least **1** (system validation).

### 2. Confirm a sales order

1. Open the quotation / SO.
2. Progress **Quotation → Quotation Sent → Sales Order** as your process requires.
3. After confirmation, commercial fields may lock — request approval for price changes instead of editing quietly.

### 3. Keep CRM current

1. Open **CRM**.
2. Move opportunities through stages; log activities.
3. Link won deals back to quotations / orders.

### 4. Follow delivery and after-sales

1. Check **Delivery** for outstanding shipments on your orders.
2. Use **After-Sales** / **Holdovers** for returns and pending customer actions.
3. Escalate invoicing and collections to **Finance** or **Admin Officer**.

### 5. Request approvals

1. Large discounts or exceptions may create approval requests.
2. Wait for Finance/Director before promising special terms to the customer.

---

## Tips

- Always attach the correct customer contact — wrong phone/email breaks portal and notifications.
- Do not invent stock promises: you cannot edit stock; ask Inventory / Admin for availability.
- Soft-cancel dead quotations so pipeline reports stay clean.

## Limitations

| You cannot | Escalate to |
|------------|-------------|
| Create purchase orders or validate GRNs | Admin / Inventory / Director |
| Edit stock levels or see purchase cost | Inventory / Admin / Director |
| Create invoice from SO / post invoice / record payment | Admin (within limit), Finance, Director |
| Bank recon, deposits admin, payroll admin | Finance / Director |
| See other reps’ full order books (typical ACL) | Director / Admin for coverage |

When a customer asks “when do I pay?”, hand off to Finance with the SO reference — do not collect offline cash without a posted invoice and payment record.
