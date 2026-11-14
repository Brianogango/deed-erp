/** Invoice status mapping shared by the invoice routes. */

// The stored status is a pure document state; payment progress
// ('paid'/'partially_paid') is derived from amount_paid at read time, so
// legacy payment statuses collapse onto the posted state.
export const INVOICE_STATUS_MAP: Record<string, string> = {
  posted:         'approved',
  paid:           'approved',
  partially_paid: 'approved',
  overdue:        'approved',
  partial:        'approved',
  pending:        'pending_approval',
  sent:           'pending_approval',
  open:           'approved',
}
