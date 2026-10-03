/**
 * Merge a table-backed collection (invoices, sale orders, quotes) into its store list without ever
 * dropping a document that only the store list knows about.
 *
 * `refreshInvoicesBlob` used to REPLACE the list with the table rows. A bill
 * whose background save to the table had failed (so it existed only in the
 * list, with its journal already posted) vanished the next time any invoice was
 * confirmed, a repair invoice was reissued, or a contact was edited.
 *
 * Table rows win for any id they contain (the table is authoritative for
 * those); documents absent from the table are kept as they are.
 */
export function mergeInvoiceMirror<T extends { id?: unknown }>(
  tableRows: T[],
  existing: unknown,
): { merged: unknown[]; kept: number } {
  const tableIds = new Set(tableRows.map(r => String(r.id)))
  const orphans = (Array.isArray(existing) ? existing : []).filter(
    (row: unknown) => !!row && typeof row === 'object'
      && (row as { id?: unknown }).id != null
      && !tableIds.has(String((row as { id: unknown }).id)),
  )
  return { merged: [...tableRows, ...orphans], kept: orphans.length }
}
