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

Terminal records must stop offering creation actions for downstream records that already exist. Existing linked documents should switch the affordance from **Create** to **View/Open**. Actions that are not valid in the current business state must disappear or be disabled with an explanation.

## Shared journey rules implemented

- `lib/user-journey.ts` centralizes Create → View → Confirm → None resolution for linked downstream documents.
- Terminal-state recognition prevents downstream creation from terminal records while still permitting users to open existing linked documents.
- `__tests__/user-journey.test.ts` locks the Create → View transition, draft confirmation, and terminal-state behavior.
- Purchase Orders/RFQs now use state-driven row actions: the duplicate View/Edit controls were collapsed into one Open action, Approve only appears while a record is actually approvable, and bulk approval only operates on actionable selected records.
- Purchase row actions now carry record-specific accessible names and larger touch targets.

## Priority journeys

### J1 — Sales to cash
Lead/opportunity → quotation → customer confirmation → sale order → delivery → invoice → post → payment → paid/closed.

Acceptance:
- one canonical next action at each stage;
- confirmed quotations do not continue to offer confirmation;
- delivered/fulfilled orders do not recreate deliveries;
- an existing invoice changes Create Invoice to View Invoice/Open Invoice;
- draft invoices expose the appropriate confirmation/posting action only to permitted roles;
- paid documents surface payment state and no longer encourage duplicate payment/invoice creation;
- Back returns to the originating list/search/filter/page context.

### J2 — Repair to collection/closure
Intake → verification → assignment → diagnosis → quotation/approval → parts if required → repair → QC → invoice/no-charge → release → collection/delivery → closed.

Acceptance:
- repair path controls which stages/actions exist;
- quote cannot be recreated once the current quote is authoritative unless revision is explicitly permitted;
- an existing invoice changes invoice creation to View/Open Invoice;
- ready/invoiced records expose release/collection rather than earlier-stage actions;
- no-charge/warranty repairs can bypass billing checkpoints where policy allows;
- serial-controlled handover requires the release checkpoint where applicable;
- terminal repairs expose history/documents, not progression CTAs;
- declined/unrepairable/return paths have an explicit terminal or reopen path.

### J3 — Purchase to pay
Purchase need/RFQ → purchase order → confirmation → goods receipt → stock → vendor bill → validation/posting → payment.

Acceptance:
- receipt cannot be duplicated after full receipt unless a deliberate additional/partial receipt is valid;
- received quantities and remaining quantities are obvious;
- vendor bill creation changes to View/Open when linked bill exists;
- bill validation is role-gated and pending-safe;
- posted/paid bills expose finance/payment state instead of creation actions.

Current implementation:
- Purchase directory action hierarchy is now state-driven and permission-aligned.
- Invalid Approve actions are not shown on confirmed/partial/received/cancelled records.
- Bulk Approve computes the actionable subset and shows its actual count.
- Open replaces the previous duplicate View + Edit controls because both led to the same form view.

### J4 — Inventory movement
Receipt/stock → serial/location visibility → transfer/reservation → validation → destination stock.

Acceptance:
- stock/serial cannot appear in two locations from one movement;
- movement state identifies source, destination and remaining action;
- completed movements do not retain Validate/Transfer CTAs;
- exceptions provide a recovery action rather than a dead end.

### J5 — Delivery
Source order/repair → preparation → release controls → dispatch/pickup → recipient confirmation → delivered.

Acceptance:
- delivery always links back to its source record;
- release/dispatch cannot be repeated after completion;
- collection/delivery captures recipient evidence required by policy;
- delivered records are read-only except permitted correction/reversal flows.

### J6 — HR self-service
Employee request (leave/expense/advance/asset) → manager/reviewer decision → downstream processing → employee-visible result.

Acceptance:
- requester always sees current state and approver/reviewer hand-off;
- approver sees the action requiring attention rather than hunting across tabs;
- approved/rejected items no longer expose the original decision action;
- notifications correspond to meaningful hand-offs and final outcomes.

### J7 — Reconfiguration / workshop
Machine → current specification → requested configuration → parts/serial selection → work → resulting specification → completed history.

Acceptance:
- long parts/component lists remain searchable and scrollable;
- selected serial/part cannot silently disappear;
- completing reconfiguration updates the machine's authoritative specification;
- the completed record shows before/after configuration and consumed/installed parts;
- completed work does not retain the original completion action.

## Cross-journey rules

- **Single dominant CTA:** one primary next action per record state; administrative actions live under secondary/More.
- **Create → View transition:** once a linked downstream document exists, never continue presenting its creation CTA unless the business process explicitly supports another document.
- **No duplicate progression:** repeated clicks and stale tabs must not create duplicate invoices, receipts, deliveries, payments or workflow transitions.
- **Explicit blockers:** missing approval, serial, stock, payment, QC, permission or prerequisite is stated next to the next-step area.
- **Role clarity:** hidden/disabled actions match server authorization; UI is not the security boundary.
- **Terminal-state discipline:** closed/cancelled/delivered/paid/returned terminal states do not present progression actions.
- **Context continuity:** list → record → linked record → Back preserves the user's originating workspace where feasible.
- **Cross-module traceability:** linked quotation/SO/delivery/invoice/payment/repair/PO/GRN/bill records are directly navigable.
- **Notification hand-offs:** notifications are generated for meaningful ownership/customer hand-offs; informational noise is avoided.
- **Mobile parity:** the dominant action, blocker and current status remain visible/reachable on phone.

## Implementation order

1. Repair — highest number of state transitions and customer hand-offs.
2. Sales → Delivery → Accounting — revenue-critical journey.
3. Purchases → GRN → Inventory → Vendor Bill — stock/cash-control journey.
4. Reconfiguration — specification and serial integrity.
5. HR requests — employee/approver hand-offs.
6. Cross-module notification and linked-record audit.

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

## Release gate

Phase 6 is complete only when journey-specific automated tests plus the repository gates pass:

```bash
npm run test
npm run typecheck
npm run build
npm run test:e2e
```

Visual walkthroughs should cover the priority journeys at phone and desktop widths. Implementation status and unresolved journey defects must be recorded before merge/deployment.
