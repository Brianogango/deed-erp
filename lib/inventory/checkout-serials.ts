/**
 * A checkout's serial numbers, in the same order as its serial ids.
 *
 * The screen labels each checkbox with serialNumbers[i] for serialIds[i].
 * The numbers used to be stored in the stock list's order instead of the
 * order the units were picked, so a box could show one serial and send
 * another (CHK-00025: "PW03TBSK" ticked, PW03TBP5 returned). Read from the
 * live serial records, so existing checkouts are labelled right too.
 *
 * Pure.
 */
export function serialNumbersInOrder(
  serialIds: string[],
  serials: Array<{ id: string; serial: string }>,
  fallback: string[] = [],
): string[] {
  const byId = new Map(serials.map(s => [s.id, s.serial]))
  return serialIds.map((id, i) => byId.get(id) || fallback[i] || id)
}
