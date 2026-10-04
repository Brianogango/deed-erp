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
 * amountPaid in the store list is never lowered; documents absent from the
 * table are kept as they are.
 */
export function mergeInvoiceMirror<T extends { id?: unknown }>(
  tableRows: T[],
  existing: unknown,
): { merged: unknown[]; kept: number } {
  const tableIds = new Set(tableRows.map(r => String(r.id)))
  // A payment that never reached the table (failed background save) leaves the
  // table's amountPaid lower than the store list's. The table must not undo it.
  const existingPaid = new Map<string, number>()
  for (const row of Array.isArray(existing) ? existing : []) {
    const r = row as { id?: unknown; amountPaid?: unknown } | null
    if (r && r.id != null && Number(r.amountPaid) > 0) existingPaid.set(String(r.id), Number(r.amountPaid))
  }
  const rows = tableRows.map(row => {
    const kept = existingPaid.get(String(row.id))
    const paid = (row as { amountPaid?: unknown }).amountPaid
    return kept != null && kept > (Number(paid) || 0) ? { ...row, amountPaid: kept } : row
  })
  const orphans = (Array.isArray(existing) ? existing : []).filter(
    (row: unknown) => !!row && typeof row === 'object'
      && (row as { id?: unknown }).id != null
      && !tableIds.has(String((row as { id: unknown }).id)),
  )
  return { merged: [...rows, ...orphans], kept: orphans.length }
}
