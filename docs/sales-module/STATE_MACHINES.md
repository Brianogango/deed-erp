# State machines (prototype vocabulary)

## Quotation
`Draft` → `Sent` → `Accepted` | `Rejected` | `Expired` → `Converted`

## Sales order
`Confirmed` → `Reserved` → `Ready to Deliver` → `Delivered` → `Invoiced` → `Paid`

## Delivery
`Awaiting Picking` → `Picking` → `Picked` → `Delivered` | `Partially Delivered` | `Cancelled`

## Invoice
`Draft` → `Posted` → `Partially Paid` → `Paid` | `Overdue` | `Cancelled`

Prototype badges use these labels; production mapping remains `lib/odoo-sales-flow.ts` until integration is approved.
