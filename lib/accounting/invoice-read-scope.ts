import type { Prisma } from '@prisma/client'
import {
  filterStoreValueForRole,
  hasFullStoreContentAccess,
  normalizePermissionRole,
} from '@/lib/auth/authorization'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'

/**
 * Which invoices and vendor bills a signed-in person may read through the
 * invoice routes. It is the same rule the store sync applies to `deed_invoices`
 * (invoiceSliceForRole), so the two ways of reading can never disagree:
 * back office sees everything, repair roles only invoices tied to a repair,
 * sales and Kilimall only customer invoices, stock control only vendor bills.
 */
type Reader = { role?: unknown; permissions?: readonly string[] | null } | null | undefined

type InvoiceRow = {
  documentType?: string | null
  invoiceNumber?: string | null
  purchaseOrderId?: string | null
  repairId?: string | null
}

/** Rows the screens treat as vendor bills (mirrors invoiceDocumentType). */
const VENDOR_BILL: Prisma.InvoiceWhereInput = {
  OR: [
    { documentType: 'vendor_bill' },
    { invoiceNumber: { startsWith: 'BILL', mode: 'insensitive' } },
    { invoiceNumber: { startsWith: 'DRAFT/BILL', mode: 'insensitive' } },
    { purchaseOrderId: { not: null } },
  ],
}

export function canReadInvoiceRow(user: Reader, row: InvoiceRow): boolean {
  const asScreenRow = { type: invoiceDocumentType(row), repairId: row.repairId ?? null }
  return (filterStoreValueForRole(user as never, 'deed_invoices', [asScreenRow]) as unknown[]).length > 0
}

/** A `where` that returns only what the person may read, so paging stays exact. */
export function invoiceReadWhere(user: Reader): Prisma.InvoiceWhereInput {
  if (hasFullStoreContentAccess(user as never, 'deed_invoices')) return {}
  switch (normalizePermissionRole(user?.role as never)) {
    case 'technical_lead':
    case 'technician':
      return { repairId: { not: null } }
    case 'sales_rep':
    case 'kilimall_officer':
      return { NOT: VENDOR_BILL }
    case 'inventory_officer':
      return VENDOR_BILL
    default:
      return { id: { in: [] } }
  }
}
