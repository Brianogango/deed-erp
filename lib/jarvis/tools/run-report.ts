import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { hasModuleAccess } from '@/lib/auth/access'
import { hasPermission } from '@/lib/auth/authorization'
import type { PublicUser } from '@/lib/auth/types'
import type { ToolDefinition } from '../types'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const inputSchema = z.object({
  report: z.enum(['sales', 'purchases', 'stock', 'receivables', 'payables']),
  fromDate: z.string().regex(DATE).optional(),
  toDate: z.string().regex(DATE).optional(),
  groupBy: z.enum(['customer', 'salesperson', 'product', 'month', 'vendor', 'category']).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})
type Input = z.infer<typeof inputSchema>

/** Quotes, drafts and cancelled orders are not sales. */
const NOT_SALES = ['quotation', 'quotation_sent', 'sent', 'draft', 'cancelled', 'canceled', 'cancel', 'void', 'voided', 'expired', 'rejected']
const OPEN_DOC_EXCLUDED = ['draft', 'cancelled', 'voided', 'paid'] as const

const money = (n: number) => Math.round(n * 100) / 100
const n = (v: unknown) => Number(v) || 0

type Row = Record<string, string | number | null>
type Report = {
  ok: true
  report: string
  title: string
  period?: { from: string; to: string }
  filters: Record<string, string>
  columns: string[]
  rows: Row[]
  totals: Row
  rowCount: number
  truncated?: boolean
  note?: string
}
type Denied = { ok: false; message: string }

function range(input: Input): { from: Date; to: Date; label: { from: string; to: string } } {
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = `${today.slice(0, 8)}01`
  const from = input.fromDate ?? monthStart
  const to = input.toDate ?? today
  return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T23:59:59.999Z`), label: { from, to } }
}

function grouped(entries: Array<{ key: string; count: number; values: Record<string, number> }>, keyLabel: string, valueCols: string[], limit: number) {
  const map = new Map<string, { count: number; values: Record<string, number> }>()
  for (const e of entries) {
    const cur = map.get(e.key) ?? { count: 0, values: Object.fromEntries(valueCols.map(c => [c, 0])) }
    cur.count += e.count
    for (const c of valueCols) cur.values[c] = money((cur.values[c] ?? 0) + (e.values[c] ?? 0))
    map.set(e.key, cur)
  }
  const sorted = [...map.entries()].sort((a, b) => (b[1].values[valueCols[0]] ?? 0) - (a[1].values[valueCols[0]] ?? 0))
  const rows: Row[] = sorted.slice(0, limit).map(([key, v]) => ({ [keyLabel]: key, Count: v.count, ...v.values }))
  const totals: Row = { [keyLabel]: 'Total', Count: sorted.reduce((s, [, v]) => s + v.count, 0) }
  for (const c of valueCols) totals[c] = money(sorted.reduce((s, [, v]) => s + (v.values[c] ?? 0), 0))
  return { rows, totals, rowCount: sorted.length, truncated: sorted.length > limit }
}

async function salesReport(user: PublicUser, input: Input, limit: number): Promise<Report | Denied> {
  if (!hasModuleAccess(user, 'sales')) return { ok: false, message: 'The sales report needs access to Sales.' }
  const { from, to, label } = range(input)
  const ownOnly = user.role === 'sales_rep'
  const withMargin = hasPermission(user, 'viewPurchaseCost')
  const groupBy = (['customer', 'salesperson', 'product', 'month'] as const).find(g => g === input.groupBy) ?? 'customer'
  const orders = await prisma.saleOrder.findMany({
    where: {
      orderDate: { gte: from, lte: to },
      status: { notIn: NOT_SALES },
      ...(ownOnly ? { OR: [{ createdById: user.id }, { salespersonId: user.id }] } : {}),
      ...(input.search ? { client: { OR: [{ name: { contains: input.search, mode: 'insensitive' } }, { companyName: { contains: input.search, mode: 'insensitive' } }] } } : {}),
    },
    include: { client: { select: { name: true, companyName: true } }, items: { include: { product: { select: { name: true, costPrice: true, latestCost: true } } } } },
  })
  const valueCols = withMargin ? ['Sales (KES)', 'Cost (KES)', 'Margin (KES)'] : ['Sales (KES)']
  const entries = groupBy === 'product'
    ? orders.flatMap(o => o.items.map(i => {
      const sales = n(i.lineTotal)
      const cost = n(i.product?.latestCost ?? i.product?.costPrice) * i.qty
      return { key: i.product?.name ?? i.description ?? 'Other', count: i.qty, values: { 'Sales (KES)': sales, 'Cost (KES)': cost, 'Margin (KES)': sales - cost } }
    }))
    : orders.map(o => {
      const sales = n(o.totalAmount)
      const cost = o.items.reduce((s, i) => s + n(i.product?.latestCost ?? i.product?.costPrice) * i.qty, 0)
      const key = groupBy === 'salesperson' ? (o.salespersonName || 'Unassigned')
        : groupBy === 'month' ? o.orderDate.toISOString().slice(0, 7)
          : (o.client.companyName || o.client.name)
      return { key, count: 1, values: { 'Sales (KES)': sales, 'Cost (KES)': cost, 'Margin (KES)': n(o.subtotal) - cost } }
    })
  const keyLabel = { customer: 'Customer', salesperson: 'Salesperson', product: 'Product', month: 'Month' }[groupBy]
  const g = grouped(entries, keyLabel, valueCols, limit)
  return {
    ok: true,
    report: 'sales',
    title: `Sales by ${keyLabel.toLowerCase()}`,
    period: label,
    filters: { groupBy, ...(ownOnly ? { scope: 'your own orders' } : {}), ...(input.search ? { customer: input.search } : {}) },
    columns: [keyLabel, groupBy === 'product' ? 'Count' : 'Count', ...valueCols],
    ...g,
    note: `Confirmed sale orders by order date (quotations and cancelled orders left out). Totals include VAT; ${withMargin ? 'margin is before VAT, using the latest purchase cost' : 'cost and margin are not shown for your role'}.${groupBy === 'product' ? ' Count is units.' : ' Count is orders.'}`,
  }
}

async function purchasesReport(user: PublicUser, input: Input, limit: number): Promise<Report | Denied> {
  if (!hasModuleAccess(user, 'purchase')) return { ok: false, message: 'The purchases report needs access to Purchases.' }
  const { from, to, label } = range(input)
  const groupBy = (['vendor', 'product', 'month'] as const).find(g => g === input.groupBy) ?? 'vendor'
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      orderDate: { gte: from, lte: to },
      status: { not: 'cancelled' },
      ...(input.search ? { vendor: { OR: [{ name: { contains: input.search, mode: 'insensitive' } }, { companyName: { contains: input.search, mode: 'insensitive' } }] } } : {}),
    },
    include: { vendor: { select: { name: true, companyName: true } }, items: { include: { product: { select: { name: true } } } } },
  })
  const entries = groupBy === 'product'
    ? orders.flatMap(o => o.items.map(i => ({ key: i.product?.name ?? i.description ?? 'Other', count: i.qtyOrdered, values: { 'Ordered (KES)': n(i.lineTotal), 'Received qty': i.qtyReceived } })))
    : orders.map(o => ({
      key: groupBy === 'month' ? o.orderDate.toISOString().slice(0, 7) : (o.vendor?.companyName || o.vendor?.name || 'Unknown vendor'),
      count: 1,
      values: { 'Ordered (KES)': n(o.totalAmount), 'Received qty': o.items.reduce((s, i) => s + i.qtyReceived, 0) },
    }))
  const keyLabel = { vendor: 'Vendor', product: 'Product', month: 'Month' }[groupBy]
  const g = grouped(entries, keyLabel, ['Ordered (KES)', 'Received qty'], limit)
  return {
    ok: true,
    report: 'purchases',
    title: `Purchases by ${keyLabel.toLowerCase()}`,
    period: label,
    filters: { groupBy, ...(input.search ? { vendor: input.search } : {}) },
    columns: [keyLabel, 'Count', 'Ordered (KES)', 'Received qty'],
    ...g,
    note: `Purchase orders by order date, cancelled ones left out.${groupBy === 'product' ? ' Count is units ordered; amounts exclude VAT.' : ' Count is orders; amounts include VAT.'}`,
  }
}

async function stockReport(user: PublicUser, input: Input, limit: number): Promise<Report | Denied> {
  if (!hasModuleAccess(user, 'inventory')) return { ok: false, message: 'The stock report needs access to Inventory.' }
  const withValue = hasPermission(user, 'viewPurchaseCost')
  const byCategory = input.groupBy === 'category'
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      trackStock: true,
      ...(input.search ? { OR: [{ name: { contains: input.search, mode: 'insensitive' } }, { sku: { contains: input.search, mode: 'insensitive' } }, { category: { name: { contains: input.search, mode: 'insensitive' } } }] } : {}),
    },
    include: { stockLevel: true, category: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })
  const cost = (p: (typeof products)[number]) => n(p.latestCost ?? p.costPrice)
  if (byCategory) {
    const valueCols = withValue ? ['On hand', 'Value (KES)'] : ['On hand']
    const g = grouped(products.map(p => ({
      key: p.category?.name ?? 'Uncategorised',
      count: 1,
      values: { 'On hand': p.stockLevel?.qtyOnHand ?? 0, 'Value (KES)': (p.stockLevel?.qtyOnHand ?? 0) * cost(p) },
    })), 'Category', valueCols, limit)
    return { ok: true, report: 'stock', title: 'Stock by category', filters: { groupBy: 'category', ...(input.search ? { search: input.search } : {}) }, columns: ['Category', 'Count', ...valueCols], ...g, note: `Count is products. ${withValue ? 'Value at latest purchase cost.' : 'Values are not shown for your role.'}` }
  }
  const sorted = [...products].sort((a, b) => (b.stockLevel?.qtyOnHand ?? 0) - (a.stockLevel?.qtyOnHand ?? 0))
  const rows: Row[] = sorted.slice(0, limit).map(p => ({
    SKU: p.sku,
    Product: p.name,
    'On hand': p.stockLevel?.qtyOnHand ?? 0,
    Reserved: p.stockLevel?.qtyReserved ?? 0,
    'Reorder at': p.reorderLevel ?? null,
    ...(withValue ? { 'Value (KES)': money((p.stockLevel?.qtyOnHand ?? 0) * cost(p)) } : {}),
  }))
  const totals: Row = {
    SKU: 'Total',
    Product: `${sorted.length} products`,
    'On hand': sorted.reduce((s, p) => s + (p.stockLevel?.qtyOnHand ?? 0), 0),
    Reserved: sorted.reduce((s, p) => s + (p.stockLevel?.qtyReserved ?? 0), 0),
    'Reorder at': null,
    ...(withValue ? { 'Value (KES)': money(sorted.reduce((s, p) => s + (p.stockLevel?.qtyOnHand ?? 0) * cost(p), 0)) } : {}),
  }
  return {
    ok: true,
    report: 'stock',
    title: 'Stock on hand',
    filters: input.search ? { search: input.search } : {},
    columns: ['SKU', 'Product', 'On hand', 'Reserved', 'Reorder at', ...(withValue ? ['Value (KES)'] : [])],
    rows,
    totals,
    rowCount: sorted.length,
    truncated: sorted.length > limit,
    note: `As of now. ${withValue ? 'Value at latest purchase cost.' : 'Values are not shown for your role.'}`,
  }
}

async function agingReport(user: PublicUser, input: Input, limit: number, kind: 'receivables' | 'payables'): Promise<Report | Denied> {
  const allowed = kind === 'receivables' ? hasPermission(user, 'recordPayment') : hasPermission(user, 'postFinancial')
  if (!allowed) return { ok: false, message: `The ${kind} report needs finance access (${kind === 'receivables' ? 'record payments' : 'post to the books'}).` }
  const docs = await prisma.invoice.findMany({
    where: {
      documentType: kind === 'receivables' ? 'customer_invoice' : 'vendor_bill',
      status: { notIn: [...OPEN_DOC_EXCLUDED] },
      ...(input.search ? { client: { OR: [{ name: { contains: input.search, mode: 'insensitive' } }, { companyName: { contains: input.search, mode: 'insensitive' } }] } } : {}),
    },
    include: { client: { select: { name: true, companyName: true } } },
  })
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  const cols = ['Not due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days', 'Balance (KES)']
  const entries = docs.map(d => {
    const balance = money(n(d.totalAmount) - n(d.amountPaid))
    const due = (d.dueDate ?? d.invoiceDate).getTime()
    const days = Math.floor((today - due) / 86_400_000)
    const bucket = days <= 0 ? 'Not due' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : 'Over 90 days'
    return { key: d.client.companyName || d.client.name, count: 1, balance, values: { [bucket]: balance, 'Balance (KES)': balance } }
  }).filter(e => e.balance > 0.009)
  const party = kind === 'receivables' ? 'Customer' : 'Vendor'
  const g = grouped(entries, party, cols, limit)
  const ordered = { ...g, rows: [...g.rows].sort((a, b) => n(b['Balance (KES)']) - n(a['Balance (KES)'])) }
  return {
    ok: true,
    report: kind,
    title: kind === 'receivables' ? 'Money owed to us (aged)' : 'Money we owe vendors (aged)',
    filters: input.search ? { [party.toLowerCase()]: input.search } : {},
    columns: [party, 'Count', ...cols],
    ...ordered,
    note: `Open ${kind === 'receivables' ? 'customer invoices' : 'vendor bills'} as of today, aged by due date. Count is documents.`,
  }
}

export const runReportTool: ToolDefinition = {
  name: 'run_report',
  description:
    'Run a business report from live records, limited to what the user may see. ' +
    'report: sales (groupBy customer | salesperson | product | month), purchases (groupBy vendor | product | month), ' +
    'stock (on hand now; groupBy category optional), receivables (money owed to us, aged), payables (money we owe, aged). ' +
    'Dates are YYYY-MM-DD and default to this month so far. Show the result as a table with its totals, and state the period, filters and note.',
  inputSchema: {
    type: 'object',
    properties: {
      report: { type: 'string', enum: ['sales', 'purchases', 'stock', 'receivables', 'payables'] },
      fromDate: { type: 'string', description: 'YYYY-MM-DD (sales and purchases)' },
      toDate: { type: 'string', description: 'YYYY-MM-DD (sales and purchases)' },
      groupBy: { type: 'string', enum: ['customer', 'salesperson', 'product', 'month', 'vendor', 'category'] },
      search: { type: 'string', description: 'Filter by customer / vendor / product name' },
      limit: { type: 'number', description: 'Rows to list (default 25, max 100); totals always cover everything' },
    },
    required: ['report'],
  },
  requiredModule: null,
  requiredPermission: null,
  mutates: false,
  run: async (ctx, rawInput) => {
    const input = inputSchema.parse(rawInput)
    const limit = input.limit ?? 25
    switch (input.report) {
      case 'sales': return salesReport(ctx.user, input, limit)
      case 'purchases': return purchasesReport(ctx.user, input, limit)
      case 'stock': return stockReport(ctx.user, input, limit)
      case 'receivables': return agingReport(ctx.user, input, limit, 'receivables')
      case 'payables': return agingReport(ctx.user, input, limit, 'payables')
    }
  },
}
