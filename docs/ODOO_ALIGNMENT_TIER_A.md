# Odoo alignment — Tier A (bank import, reorder, deposits, partners, WHT, portal)

## 1. Bank statement CSV import
- **Where:** Cashbook → account reconciliation → Statement Lines
- **Actions:** Download CSV template, Import CSV for the selected month
- **Parser:** `lib/bank-statement-csv.ts` (flexible Kenyan bank headers)
- After import, use existing Auto-Match

## 2. Reorder → draft POs
- **Where:** Inventory → Reports → Low Stock → **Generate reorder POs**
- **API:** `GET/POST /api/inventory/reorder-pos` (supports `dryRun`)
- Creates draft POs from products at/under `minStock` / `reorderLevel`
- Assign vendor in Purchase before confirming

## 3. Deposits wired to invoices (down-payments)
- Creating a deposit still creates a linked quotation SO and now stores `saleOrderId`
- **Apply to Invoice** on the deposit (or **Apply Deposit** on a posted invoice)
- Accounting: DR `3100 Customer Deposits` / CR `1800 AR`
- Posting a customer invoice auto-applies SO-linked unapplied deposits

## 4. Client + Supplier unify
- Purchase already uses `Contact.isVendor`
- **Contacts → More → Unify suppliers → vendors** calls `POST /api/partners/migrate-suppliers`
- Copies Prisma `Supplier` rows into Client/Contact vendors; Supplier table kept for legacy FKs

## 5. WHT + payment reminders
- **Settings → Accounting → Taxes:** enable WHT + rate (default 5%)
- Vendor bill payments withhold to `3350 - Withholding Tax Payable` and pay net from bank
- **Finance → Ageing:** Preview / Send AR reminders (email) with signed invoice portal links
- API: `POST /api/finance/payment-reminders`

## 6. Invoice + order customer portal
- Public pages: `/portal/invoices/[id]?token=…`, `/portal/orders/[id]?token=…`
- Tokens: `lib/portal-document-token.ts` (30-day HMAC, same secret as quotes)
- Middleware allows `/api/portal/invoices` and `/api/portal/orders`
