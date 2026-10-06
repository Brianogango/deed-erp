/**
 * Merge a table-backed collection (invoices, sale orders, quotes) into its store list without ever
 * dropping a document that only the store list knows about.
 *
 * `refreshInvoicesBlob` used to REPLACE the list with the table rows. A bill
 * whose background save to the table had failed (so it existed only in the
 * list, with its journal already posted) vanished the next time any invoice was
 * confirmed, a repair invoice was reissued, or a contact was edited.
 *
 * Table rows win for any id they contain, except that a higher recorded
 * amountPaid in the store list is never lowered (unless a payment was
 * reversed) and the document's payment lists are carried over; documents
 * absent from the table are kept as they are.
 */
export function mergeInvoiceMirror<T extends { id?: unknown }>(
  tableRows: T[],
  existing: unknown,
): { merged: unknown[]; kept: number } {
  const tableIds = new Set(tableRows.map(r => String(r.id)))
  // A payment that never reached the table (failed background save) leaves the
  // table's amountPaid lower than the store list's. The table must not undo it.
  const existingPaid = new Map<string, number>()
  // The table has no payment lists: the payments shown on the document and
  // the reversed ones (lib/accounting/payment-reversal.ts) live in the store
  // list only, and a refresh used to drop them.
  const existingLists = new Map<string, { payments?: unknown; voidedPayments?: unknown }>()
  for (const row of Array.isArray(existing) ? existing : []) {
    const r = row as { id?: unknown; amountPaid?: unknown; payments?: unknown; voidedPayments?: unknown } | null
    if (!r || r.id == null) continue
    const reversed = Array.isArray(r.voidedPayments) && r.voidedPayments.length > 0
    // After a reversal the table's (lower) figure is the right one.
    if (Number(r.amountPaid) > 0 && !reversed) existingPaid.set(String(r.id), Number(r.amountPaid))
    if (Array.isArray(r.payments) || Array.isArray(r.voidedPayments)) {
      existingLists.set(String(r.id), { payments: r.payments, voidedPayments: r.voidedPayments })
    }
  }
  const rows = tableRows.map(row => {
    const id = String(row.id)
    const kept = existingPaid.get(id)
    const paid = (row as { amountPaid?: unknown }).amountPaid
    const lists = existingLists.get(id)
    const withLists = lists
      ? {
          ...row,
          ...(Array.isArray(lists.payments) && !Array.isArray((row as { payments?: unknown }).payments) ? { payments: lists.payments } : {}),
          ...(Array.isArray(lists.voidedPayments) ? { voidedPayments: lists.voidedPayments } : {}),
        }
      : row
    return kept != null && kept > (Number(paid) || 0) ? { ...withLists, amountPaid: kept } : withLists
  })
  const orphans = (Array.isArray(existing) ? existing : []).filter(
    (row: unknown) => !!row && typeof row === 'object'
      && (row as { id?: unknown }).id != null
      && !tableIds.has(String((row as { id: unknown }).id)),
  )
  return { merged: [...rows, ...orphans], kept: orphans.length }
}
