# Permission matrix (prototype)

| Action | Prototype | Production roles (existing) |
|--------|-----------|-----------------------------|
| Create quotation | Demo CTA | `manageSaleOrders` |
| Send quotation | Toast only | sales_rep+ |
| Confirm quotation | Dialog → navigate | director, sales_rep, admin_officer |
| Reserve stock | Toast | inventory + sales flows |
| Validate delivery | Toast | `manageDeliveries` |
| Create invoice | Navigate | `createCustomerInvoiceFromSO` |
| Register payment | Toast | `recordPayment` |
| View margin | Shown on quote totals | needs explicit gate before prod |

**Do not** treat prototype button visibility as authorization.
