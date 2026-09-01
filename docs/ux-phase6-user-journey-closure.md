# ERP UX Phase 6 — User journey closure

Phase 6 implementation baseline is complete on `ux/phase6-user-journeys`, stacked on Phase 4–5.

## What is now enforced

- Shared Create → Confirm/View → None linked-document semantics live in `lib/user-journey.ts`.
- Repair billing now has a dedicated journey resolver in `lib/repair-journey.ts` so an existing invoice can never resolve back to **Create Invoice**. Draft invoice → **Confirm Invoice**; posted/current invoice → **View Invoice**; existing unpaid out-of-sync invoice → **Align Invoice with Quote**; terminal/no-charge jobs do not create a new customer invoice.
- Purchase Orders/RFQs expose one Open action rather than duplicate View/Edit actions, only expose approval while approval is actionable, and only bulk-approve the actionable subset.
- Existing Sales order logic already uses `saleOrderInvoicePrimaryAction`, which resolves draft linked invoices to Confirm, fully-covered/posting-complete orders to View, and only returns Create when a new invoice is genuinely due.
- Existing Repair detail logic already uses `pickRepairPrimaryAction` to select one dominant repair CTA and `repairBillingNeedsSync` to distinguish missing billing from invoice alignment.
- Existing reconfiguration service contains the authoritative-spec writeback path that fixes the completed-work-order case where status changed back to available but specs remained stale.
- Existing Phase 1 route/list-state work preserves list context and Back behavior across major modules.
- Existing Phase 4–5 shared mobile/action/accessibility primitives keep the same journey meaning available on phone.

## Journey status

### Sales → cash
Baseline complete: quotation confirmation, delivery state, invoice primary action, posting/payment state and list-context restoration are represented by shared state helpers rather than button-label guesses.

### Repair → collection/closure
Baseline complete: one dominant CTA, explicit no-charge path, billing sync rules, invoice journey rules, ORC/release checkpoint logic, collection/handover rules and terminal states are represented explicitly.

### Purchase → pay
Baseline complete: RFQ/PO action hierarchy, GRN gating, partial/full receipt state, billable quantity logic, bill validation and payment state are represented explicitly. Directory approval dead ends were removed in this phase.

### Inventory movement
Baseline complete through existing receipt/stock/serial validation controls and server-side stock movement rules. Phase 6 adds no alternate client-only state machine.

### Delivery
Baseline complete through existing delivery source linkage, delivery state helpers, release/handover controls and terminal-state handling.

### HR self-service
Baseline complete through existing role-gated request/approval states and the shared Phase 2–5 feedback/navigation primitives. Phase 6 does not weaken or duplicate approval authorization.

### Reconfiguration
Baseline complete through the existing searchable component picker, authoritative serial-spec writeback and completed-work-order state handling.

## Tests added in Phase 6

- `__tests__/user-journey.test.ts`
  - Create → View transition
  - draft → Confirm transition
  - terminal records do not create downstream records
  - terminal records may still open existing linked documents
- `__tests__/repair-journey.test.ts`
  - missing invoice → Create Invoice
  - existing posted invoice → View Invoice
  - existing draft invoice → Confirm Invoice
  - out-of-sync existing invoice → Align, never Create
  - paid invoice is not rewritten
  - terminal/no-charge repair billing discipline

## Acceptance checklist

- [x] One dominant next-step model exists for the most complex repair workflow.
- [x] Sales invoice action is derived from linked invoice state and invoiceability.
- [x] Existing linked documents resolve away from duplicate Create actions.
- [x] Draft linked invoices can resolve to Confirm rather than duplicate creation.
- [x] Terminal records do not create new downstream documents.
- [x] Purchase approval dead ends were removed from row/bulk actions.
- [x] Purchase actions are permission/state aligned.
- [x] Repair no-charge and release checkpoints are explicit.
- [x] Reconfiguration authoritative spec writeback exists after completion.
- [x] Back/list context remains delegated to the Phase 1 URL-state foundation.
- [x] Mobile journey parity remains delegated to the Phase 4–5 shared action/layout layer.
- [ ] Unit/integration tests executed and passing on the final Phase 6 head.
- [ ] Typecheck executed and passing on the final Phase 6 head.
- [ ] Production build executed and passing on the final Phase 6 head.
- [ ] E2E journey suite executed and passing on the final Phase 6 head.
- [ ] Phone + desktop visual walkthrough completed for the priority journeys.

## Release status

**Implementation baseline: COMPLETE.**

**Release verification: PENDING.**

Do not merge/deploy Phase 6 solely because GitHub reports the branch as mergeable. Verify:

```bash
npm run test
npm run typecheck
npm run build
npm run test:e2e
```

Then complete phone + desktop walkthroughs for Sales, Repair, Purchase/GRN/Bill, Delivery and Reconfiguration before production rollout.
