# Sales Module — workflow (prototype)

Draft Quotation → Save → Send → Customer Acceptance → Confirm → Sales Order → Reserve Stock → Create Delivery → Pick Serials/Qty → Validate → Delivered → Create Invoice → Post → Record Payment → Complete.

Traceability demo links:

- Quotation `SQ/2026/0142` → SO `SO/2026/0087` → DN `DN/2026/0044` → INV `INV/2026/0312` → PAY `PAY/2026/0881`

Prototype routes under `/sales-prototype/*` use **demo data only** — no `saveStoreKeys`, Prisma writes, or production APIs.
