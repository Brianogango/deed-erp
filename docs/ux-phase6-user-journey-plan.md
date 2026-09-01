# ERP UX Phase 6 — End-to-end user journeys

Phase 6 proves that a user can complete real work from entry to terminal state without dead ends, contradictory actions, duplicate documents, lost context or unexplained hand-offs.

This phase is stacked on the Phase 4–5 UX branch and does not weaken permissions, accounting rules, stock controls, audit rules or security controls.

## Journey contract

Every operational record should answer five questions without forcing the user to infer state from several tabs:

1. **Where am I?** — canonical status and workflow stage.
2. **What happened?** — linked upstream records and meaningful history.
3. **What do I need to do next?** — one dominant permitted next action.
4. **What is blocking me?** — explicit blocker with the owner/required prerequisite.
5. **What happens after this?** — predictable downstream record/status and a direct way to open it.

Terminal records must stop offering creation actions for downstream records that already exist. Existing linked documents switch the affordance from **Create** to **View/Open**; draft linked documents may resolve to **Confirm** for permitted roles. Actions that are not valid in the current business state disappear or are disabled with an explanation.

## Shared journey rules implemented

- `lib/user-journey.ts` centralizes Create → View → Confirm → None resolution for linked downstream documents.
- Terminal-state recognition prevents downstream creation from terminal records while still permitting users to open existing linked documents.
- `__tests__/user-journey.test.ts` locks the Create → View transition, draft confirmation, and terminal-state behavior.
- `lib/repair-journey.ts` codifies repair invoice behavior: missing invoice → Create, draft invoice → Confirm, current posted invoice → View, out-of-sync unpaid invoice → Align, terminal/no-charge → no new invoice.
- `__tests__/repair-journey.test.ts` protects those repair invoice transitions.
- Purchase Orders/RFQs use state-driven row actions: duplicate View/Edit controls were collapsed into one Open action, Approve only appears while a record is actually approvable, and bulk approval only operates on actionable selected records.
- Purchase row actions carry record-specific accessible names and larger touch targets.

## Priority journeys

### J1 — Sales to cash
Lead/opportunity → quotation → customer confirmation → sale order → delivery → invoice → post → payment → paid/closed.

Implemented baseline:
- existing Sales workflow derives quotation/SO state from the canonical sales-flow helpers;
- `saleOrderInvoicePrimaryAction` already resolves an existing draft invoice to Confirm and a fully covered posted invoice to View instead of duplicate Create;
- delivery, invoice and payment status remain separate dimensions rather than overloaded status labels;
- Phase 1 URL-state behavior preserves originating list context.

### J2 — Repair to collection/closure
Intake → verification → assignment → diagnosis → quotation/approval → parts if required → repair → QC → invoice/no-charge → release → collection/delivery → closed.

Implemented baseline:
- `pickRepairPrimaryAction` provides one dominant workflow CTA;
- repair path controls diagnosis/quote/start rules;
- `repairBillingNeedsSync` distinguishes missing invoice from alignment/rewrite conditions;
- `repairInvoiceJourneyAction` prevents an existing invoice from resolving to Create Invoice;
- draft invoice → Confirm Invoice; posted/current invoice → View Invoice; unpaid mismatch → Align Invoice with Quote;
- no-charge/warranty paths can bypass customer billing where policy allows;
- serial-controlled handover and ORC release checkpoints remain explicit;
- terminal repairs do not create new customer invoices.

### J3 — Purchase to pay
Purchase need/RFQ → purchase order → confirmation → goods receipt → stock → vendor bill → validation/posting → payment.

Implemented baseline:
- Purchase directory action hierarchy is state-driven and permission-aligned;
- invalid Approve actions are not shown on confirmed/partial/received/cancelled records;
- bulk Approve computes the actionable subset and shows its actual count;
- Open replaces duplicate View + Edit controls because both led to the same form view;
- GRN eligibility is based on outstanding quantity and role;
- billable quantities account for already billed quantities;
- vendor bill validation/payment use document and payment state rather than a generic PO status.

### J4 — Inventory movement
Receipt/stock → serial/location visibility → transfer/reservation → validation → destination stock.

Implemented baseline:
- existing receipt/stock/serial validation and server-side inventory movement rules remain authoritative;
- completed movement behavior is not replaced with a competing client-only journey state;
- exceptions stay on the existing recoverable inventory surfaces.

### J5 — Delivery
Source order/repair → preparation → release controls → dispatch/pickup → recipient confirmation → delivered.

Implemented baseline:
- source linkage and canonical delivery-state helpers remain authoritative;
- completed/cancelled delivery states are distinct from open delivery states;
- repair collection/handover captures recipient details and release checkpoint state;
- delivered records move out of normal progression actions except permitted correction/reversal paths.

### J6 — HR self-service
Employee request (leave/expense/advance/asset) → manager/reviewer decision → downstream processing → employee-visible result.

Implemented baseline:
- existing role-gated HR request/approval states remain authoritative;
- shared Phase 2–5 form, feedback, navigation and accessibility primitives support the request/reviewer hand-off;
- Phase 6 does not add duplicate approval paths or weaken server authorization.

### J7 — Reconfiguration / workshop
Machine → current specification → requested configuration → parts/serial selection → work → resulting specification → completed history.

Implemented baseline:
- long component/serial choices remain searchable and scrollable through the shared picker work;
- existing reconfiguration service writes the resulting authoritative specification back to the serial/device after completion;
- completed work-order status and resulting specs are kept together rather than allowing status-only completion.

## Cross-journey rules

- **Single dominant CTA:** one primary next action per record state; administrative actions live under secondary/More.
- **Create → View/Confirm transition:** once a linked downstream document exists, do not continue presenting its creation CTA unless the business process explicitly supports another document.
- **No duplicate progression:** repeated clicks and stale tabs must not create duplicate invoices, receipts, deliveries, payments or workflow transitions.
- **Explicit blockers:** missing approval, serial, stock, payment, QC, permission or prerequisite is stated next to the next-step area.
- **Role clarity:** hidden/disabled actions match server authorization; UI is not the security boundary.
- **Terminal-state discipline:** closed/cancelled/delivered/paid/returned terminal states do not present progression actions.
- **Context continuity:** list → record → linked record → Back preserves the user's originating workspace where feasible.
- **Cross-module traceability:** linked quotation/SO/delivery/invoice/payment/repair/PO/GRN/bill records remain directly navigable on the surfaces that expose them.
- **Notification hand-offs:** notification work should correspond to meaningful ownership/customer hand-offs rather than informational noise.
- **Mobile parity:** the dominant action, blocker and current status use the Phase 4–5 mobile/action foundations.

## Verification matrix

For every journey test at minimum:
- permitted primary role;
- unauthorized/adjacent role;
- desktop;
- phone;
- fresh record;
- partially completed record;
- terminal record;
- stale-tab/repeated-action attempt;
- linked-document navigation and Back restoration.

## Status

Implementation baseline: **COMPLETE**.

Detailed closure: `docs/ux-phase6-user-journey-closure.md`.

Release verification is still required before merge/deployment:

```bash
npm run test
npm run typecheck
npm run build
npm run test:e2e
```

Phone + desktop walkthroughs should cover Sales, Repair, Purchase/GRN/Bill, Delivery and Reconfiguration. Do not treat GitHub mergeability as evidence that these gates passed.
