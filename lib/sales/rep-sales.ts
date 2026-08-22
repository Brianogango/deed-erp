import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { isCommissionCloserRole } from '@/lib/sales/commission-closer'

export type SaleAttributionDoc = {
  id: string
  ref?: string
  date?: string
  createdAt?: string
  customerName?: string
  total?: number
  status?: string
  salespersonId?: string
  salespersonName?: string
  createdByUserId?: string
  createdByName?: string
}

export type AttributedSale = {
  id: string
  ref: string
  source: 'sale_order' | 'pos'
  date: string
  customerName: string
  total: number
  closerId: string
  closerName: string
}

export function saleDateKey(value?: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.slice(0, 10)
}

export function isClosedSaleOrder(status?: string): boolean {
  return normalizeSaleStatus(status) === 'sale'
}

export function closerIdOf(doc: Pick<SaleAttributionDoc, 'salespersonId' | 'createdByUserId'>): string {
  return String(doc.salespersonId || doc.createdByUserId || '').trim()
}

export function closerNameOf(doc: Pick<SaleAttributionDoc, 'salespersonName' | 'createdByName'>): string {
  return String(doc.salespersonName || doc.createdByName || '').trim()
}

export function dateInInclusiveRange(date: string | undefined, start: string, end: string): boolean {
  const key = saleDateKey(date)
  return Boolean(key && key >= start && key <= end)
}

export function attributedSaleOrders(orders: readonly SaleAttributionDoc[]): AttributedSale[] {
  return (orders ?? [])
    .filter(order => isClosedSaleOrder(order.status) && closerIdOf(order))
    .map(order => ({
      id: order.id,
      ref: String(order.ref || order.id),
      source: 'sale_order' as const,
      date: saleDateKey(order.date || order.createdAt),
      customerName: String(order.customerName || 'Customer'),
      total: Number(order.total) || 0,
      closerId: closerIdOf(order),
      closerName: closerNameOf(order) || 'Salesperson',
    }))
}

export function attributedPosOrders(orders: readonly SaleAttributionDoc[]): AttributedSale[] {
  return (orders ?? [])
    .filter(order => closerIdOf(order))
    .map(order => ({
      id: order.id,
      ref: String(order.ref || order.id),
      source: 'pos' as const,
      date: saleDateKey(order.date || order.createdAt),
      customerName: String(order.customerName || 'Walk-in Customer'),
      total: Number(order.total) || 0,
      closerId: closerIdOf(order),
      closerName: closerNameOf(order) || 'Salesperson',
    }))
}

export function attributedSales(opts: {
  saleOrders?: readonly SaleAttributionDoc[]
  posOrders?: readonly SaleAttributionDoc[]
}): AttributedSale[] {
  return [
    ...attributedSaleOrders(opts.saleOrders ?? []),
    ...attributedPosOrders(opts.posOrders ?? []),
  ]
}

export function salesForCloser(
  sales: readonly AttributedSale[],
  closerId: string | null | undefined,
  start?: string,
  end?: string,
): AttributedSale[] {
  if (!closerId) return []
  return sales.filter(sale => {
    if (sale.closerId !== closerId) return false
    if (start && end) return dateInInclusiveRange(sale.date, start, end)
    return true
  })
}

export function summarizeCloserSales(sales: readonly AttributedSale[]): {
  salesCount: number
  saleAmount: number
} {
  return {
    salesCount: sales.length,
    saleAmount: sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0),
  }
}

export function isRepCandidateRole(role?: string | null): boolean {
  return isCommissionCloserRole(role) || role === 'finance_officer'
}

const FULL_SALES_VIEW_ROLES = ['director', 'finance_officer', 'admin_officer'] as const

export function salesVisibleToViewer<T extends { salespersonId?: string; createdByUserId?: string }>(
  viewer: { id?: string; role?: string | null } | null | undefined,
  docs: readonly T[],
): T[] {
  const list = Array.isArray(docs) ? docs : []
  if (!viewer) return []
  if ((FULL_SALES_VIEW_ROLES as readonly string[]).includes(String(viewer.role || ''))) return [...list]
  return list.filter(doc => doc.salespersonId === viewer.id || doc.createdByUserId === viewer.id)
}
