/**
 * Whether a refurbishment part was taken out of warehouse stock for its job.
 * Rows from before `stockTaken` existed: only allocation (by the lead or
 * automatically) took stock, and it always set allocatedDate.
 */
export function refurbPartStockTaken(part: { stockTaken?: boolean; allocatedDate?: string }): boolean {
  return part.stockTaken ?? Boolean(part.allocatedDate)
}
