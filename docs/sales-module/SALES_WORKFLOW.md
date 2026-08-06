# Sales workflow (prototype)

```
Draft Quotation → Save → Send → Customer Acceptance → Confirm
  → Sales Order → Reserve Stock → Create Delivery → Pick (serial/qty)
  → Validate / Mark Delivered → Create Invoice → Post → Record Payment → Complete
```

## Document hierarchy

Quotation → Sales Order → Delivery Order → Invoice → Payment

Each prototype detail page shows related-document links (blue).

## Prototype behaviour

All primary/secondary actions show a toast: **"Prototype only — not connected to production data."**  
No `saveStoreKeys`, Prisma writes, or production APIs are called.
