import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { resolvePOLineProducts } from '@/lib/purchase/po-prisma-sync'
import { computePOTotals, mapPOItemsForCreate, publishPurchaseOrder } from '@/lib/purchase/po-api-shared'
import type { ConfirmPreview, ConfirmResult, ToolDefinition } from '../types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

const inputSchema = z.object({
  vendor: z.string().trim().min(1).max(200),
  lines: z.array(z.object({
    product: z.string().trim().min(1).max(200),
    qty: z.number().int().min(1).max(100_000),
    unitCost: z.number().finite().nonnegative().optional(),
    taxRate: z.number().min(0).max(100).optional(),
  })).min(1).max(50),
  expectedDate: z.string().regex(DATE).optional(),
  supplierRef: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
})

/** What the confirm step receives: everything already resolved to ids. */
const resolvedSchema = z.object({
  vendorId: z.string().regex(UUID),
  lines: z.array(z.object({
    productId: z.string().regex(UUID),
    productName: z.string(),
    qty: z.number().int().min(1),
    unitPrice: z.number().nonnegative(),
    taxRate: z.number().min(0).max(100),
  })).min(1),
  expectedDate: z.string().regex(DATE).optional(),
  notes: z.string().optional(),
})

async function findVendor(query: string) {
  if (UUID.test(query)) return prisma.client.findUnique({ where: { id: query } }).then(c => (c ? [c] : []))
  const where = {
    OR: [
      { name: { contains: query, mode: 'insensitive' as const } },
      { companyName: { contains: query, mode: 'insensitive' as const } },
      { clientNumber: { equals: query, mode: 'insensitive' as const } },
    ],
  }
  const vendors = await prisma.client.findMany({ where: { ...where, isVendor: true }, take: 5, orderBy: { name: 'asc' } })
  return vendors.length ? vendors : prisma.client.findMany({ where, take: 5, orderBy: { name: 'asc' } })
}

async function findProduct(query: string) {
  if (UUID.test(query)) return prisma.product.findUnique({ where: { id: query } })
  const exact = await prisma.product.findFirst({
    where: { isActive: true, OR: [{ sku: { equals: query, mode: 'insensitive' } }, { name: { equals: query, mode: 'insensitive' } }] },
  })
  if (exact) return exact
  return prisma.product.findFirst({
    where: { isActive: true, OR: [{ name: { contains: query, mode: 'insensitive' } }, { sku: { contains: query, mode: 'insensitive' } }] },
    orderBy: { name: 'asc' },
  })
}

const kes = (n: number) => `KES ${(Math.round(n * 100) / 100).toLocaleString('en-KE')}`

export const createPurchaseOrderTool: ToolDefinition = {
  name: 'create_purchase_order',
  description:
    'Prepare a draft purchase order to a vendor. Use search_vendors and check_inventory first to find the vendor and products; ' +
    'unit costs default to the latest purchase cost when not given. ' +
    'This only prepares a card: the user confirms it before the draft PO is saved. Sending and approving the PO happen in Purchases.',
  inputSchema: {
    type: 'object',
    properties: {
      vendor: { type: 'string', description: 'Vendor id (preferred, from search_vendors) or name' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            product: { type: 'string', description: 'Product id (preferred, from check_inventory), SKU or name' },
            qty: { type: 'number' },
            unitCost: { type: 'number', description: 'KES per unit, excluding VAT' },
            taxRate: { type: 'number', description: 'VAT %, e.g. 16' },
          },
          required: ['product', 'qty'],
        },
      },
      expectedDate: { type: 'string', description: 'Expected delivery, YYYY-MM-DD' },
      supplierRef: { type: 'string', description: "The vendor's quote or invoice number" },
      notes: { type: 'string' },
    },
    required: ['vendor', 'lines'],
  },
  requiredModule: 'purchase',
  requiredPermission: null,
  mutates: true,
  run: async (_ctx, rawInput): Promise<ConfirmPreview | { ok: false; message: string; candidates?: unknown }> => {
    const input = inputSchema.parse(rawInput)
    const vendors = await findVendor(input.vendor)
    if (!vendors.length) {
      return { ok: false, message: `No vendor matches "${input.vendor}". Create the vendor first (create_contact with isVendor true).` }
    }
    const exact = vendors.find(v => [v.name, v.companyName].some(n => n?.toLowerCase() === input.vendor.toLowerCase()))
    if (!exact && vendors.length > 1 && !UUID.test(input.vendor)) {
      return {
        ok: false,
        message: `Several vendors match "${input.vendor}" — ask which one, then pass its id.`,
        candidates: vendors.map(v => ({ id: v.id, name: v.companyName || v.name, clientNumber: v.clientNumber, isVendor: v.isVendor })),
      }
    }
    const vendor = exact ?? vendors[0]

    const lines: z.infer<typeof resolvedSchema>['lines'] = []
    const missing: string[] = []
    const noCost: string[] = []
    for (const l of input.lines) {
      const product = await findProduct(l.product)
      if (!product) { missing.push(l.product); continue }
      const cost = l.unitCost ?? Number(product.latestCost ?? product.costPrice ?? 0)
      if (l.unitCost == null && !(cost > 0)) noCost.push(product.name)
      lines.push({ productId: product.id, productName: product.name, qty: l.qty, unitPrice: cost, taxRate: l.taxRate ?? 0 })
    }
    if (missing.length) {
      return { ok: false, message: `Not in the catalog: ${missing.join(', ')}. Check the names with check_inventory, or add them with create_product first.` }
    }

    const totals = computePOTotals(lines.map(l => ({ qtyOrdered: l.qty, unitCost: l.unitPrice, taxRate: l.taxRate })))
    const warnings = [
      ...(noCost.length ? [`No cost on record for ${noCost.join(', ')} — the line is at KES 0; give the vendor's price`] : []),
      ...(vendor.isVendor ? [] : [`${vendor.companyName || vendor.name} is not marked as a vendor yet; saving marks it`]),
    ]
    const notes = [input.supplierRef ? `Vendor ref: ${input.supplierRef}` : '', input.notes ?? ''].filter(Boolean).join('\n') || undefined
    return {
      ok: true,
      needsConfirmation: true,
      title: `Draft PO · ${vendor.companyName || vendor.name}`,
      lines: [
        ...lines.map(l => ({ label: `${l.qty} × ${l.productName}`, value: `${kes(l.unitPrice)} each${l.taxRate ? ` + ${l.taxRate}% VAT` : ''}` })),
        { label: 'Subtotal', value: kes(totals.subtotal) },
        ...(totals.taxAmount ? [{ label: 'VAT', value: kes(totals.taxAmount) }] : []),
        { label: 'Total', value: kes(totals.totalAmount) },
        ...(input.expectedDate ? [{ label: 'Expected', value: input.expectedDate }] : []),
        ...(input.supplierRef ? [{ label: 'Vendor ref', value: input.supplierRef }] : []),
      ],
      warnings: warnings.length ? warnings : undefined,
      input: { vendorId: vendor.id, lines, expectedDate: input.expectedDate, notes },
      message: `A confirmation card for a draft PO to ${vendor.companyName || vendor.name}, total ${kes(totals.totalAmount)}, is shown to the user. Nothing is saved until they click Confirm.${warnings.length ? ` Point out: ${warnings.join('; ')}.` : ''}`,
    }
  },
  confirm: {
    execute: async (ctx, rawInput): Promise<ConfirmResult> => {
      const input = resolvedSchema.parse(rawInput)
      const vendor = await prisma.client.findUnique({ where: { id: input.vendorId }, select: { id: true, name: true, companyName: true, isVendor: true } })
      if (!vendor) return { ok: false, message: 'That vendor no longer exists — nothing was created.' }
      if (!vendor.isVendor) await prisma.client.update({ where: { id: vendor.id }, data: { isVendor: true } })
      // Same steps as POST /api/purchase-orders: draft status, server totals.
      const items = await resolvePOLineProducts(mapPOItemsForCreate(input.lines))
      const totals = computePOTotals(items)
      const poNumber = await getNextDocNumber('purchase_order')
      const created = await prisma.purchaseOrder.create({
        data: {
          poNumber,
          clientId: vendor.id,
          status: 'draft',
          orderDate: new Date(),
          expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          notes: input.notes ?? `Created by DIA for ${ctx.user.name ?? ctx.user.username}`,
          createdById: ctx.user.id,
          items: { create: items },
        } as any,
        include: { vendor: true, items: { include: { product: true } } },
      })
      await publishPurchaseOrder(created)
      return {
        ok: true,
        id: created.id,
        ref: created.poNumber,
        href: '/purchases',
        message: `Draft ${created.poNumber} to ${vendor.companyName || vendor.name} saved — ${kes(totals.totalAmount)}. Send or approve it in Purchases.`,
      }
    },
  },
}
