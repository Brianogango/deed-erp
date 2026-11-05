import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { productSchema } from '@/lib/validation'
import { publishProduct } from '@/lib/product-catalog-write'
import type { ConfirmPreview, ConfirmResult, ToolDefinition } from '../types'

const inputSchema = z.object({
  name: z.string().trim().min(3).max(500),
  category: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(50).optional(),
  barcode: z.string().trim().max(100).optional(),
  salePrice: z.number().finite().nonnegative(),
  costPrice: z.number().finite().nonnegative().optional(),
  productKind: z.enum(['storable', 'consumable', 'service']).optional(),
  productType: z.enum(['new', 'refurbished']).optional(),
  requiresSerial: z.boolean().optional(),
  warrantyMonths: z.number().int().min(0).max(240).optional(),
  unit: z.string().trim().max(40).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  minStock: z.number().int().min(0).max(1_000_000).optional(),
  description: z.string().trim().max(1000).optional(),
})
type Input = z.infer<typeof inputSchema>

function toValidated(i: Input) {
  return productSchema.parse({
    name: i.name,
    category: i.category,
    sku: i.sku || undefined,
    barcode: i.barcode || undefined,
    salePrice: i.salePrice,
    costPrice: i.costPrice ?? 0,
    productKind: i.productKind ?? 'storable',
    productType: i.productType ?? 'refurbished',
    trackingMethod: i.requiresSerial ? 'SERIAL' : undefined,
    requiresSerial: i.requiresSerial ?? false,
    warrantyMonths: i.warrantyMonths,
    unit: i.unit || undefined,
    taxRate: i.taxRate ?? 0,
    minStock: i.minStock ?? 5,
    description: i.description || undefined,
  })
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`

export const createProductTool: ToolDefinition = {
  name: 'create_product',
  description:
    'Add a new product to the inventory catalog (inventory staff only). Check check_inventory first so you do not create a duplicate. ' +
    'Needs a name, a category (prefer one of the existing categories the tool lists) and a selling price; ask for the price if you cannot find it. ' +
    'This only prepares a card: the user confirms it before anything is saved. Stock is never added here — it comes in through purchase receipts.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full product name, e.g. "HP EliteBook 840 G6 i5 16GB 256GB"' },
      category: { type: 'string', description: 'Catalog category, e.g. Laptops' },
      sku: { type: 'string', description: 'Leave out to generate one' },
      barcode: { type: 'string' },
      salePrice: { type: 'number', description: 'Selling price in KES' },
      costPrice: { type: 'number', description: 'Cost price in KES, if known' },
      productKind: { type: 'string', enum: ['storable', 'consumable', 'service'], description: 'Default storable' },
      productType: { type: 'string', enum: ['new', 'refurbished'], description: 'Default refurbished' },
      requiresSerial: { type: 'boolean', description: 'Each unit has a serial number (laptops, phones)' },
      warrantyMonths: { type: 'number' },
      unit: { type: 'string', description: 'e.g. pcs' },
      taxRate: { type: 'number', description: 'VAT %, e.g. 16 (default 0)' },
      minStock: { type: 'number', description: 'Reorder level (default 5)' },
      description: { type: 'string' },
    },
    required: ['name', 'category', 'salePrice'],
  },
  requiredModule: 'inventory',
  requiredPermission: null,
  mutates: true,
  run: async (_ctx, rawInput): Promise<ConfirmPreview | { ok: false; message: string; categories?: string[] }> => {
    const input = inputSchema.parse(rawInput)
    toValidated(input) // same checks as the Inventory form
    const dup = await prisma.product.findFirst({
      where: {
        OR: [
          { name: { equals: input.name, mode: 'insensitive' } },
          ...(input.sku ? [{ sku: { equals: input.sku, mode: 'insensitive' as const } }] : []),
          ...(input.barcode ? [{ barcode: input.barcode }] : []),
        ],
      },
      select: { name: true, sku: true },
    })
    if (dup) return { ok: false, message: `"${dup.name}" (SKU ${dup.sku}) is already in the catalog — use it instead.` }

    const categories = (await prisma.category.findMany({ select: { name: true }, orderBy: { name: 'asc' }, take: 200 })).map(c => c.name)
    const known = categories.find(c => c.toLowerCase() === input.category.toLowerCase())
    const warnings: string[] = []
    if (!known) warnings.push(`"${input.category}" is a new category. Existing ones: ${categories.slice(0, 25).join(', ')}`)
    if (input.costPrice != null && input.costPrice > input.salePrice) warnings.push('The cost is higher than the selling price')
    const category = known ?? input.category
    const lines = [
      { label: 'Name', value: input.name },
      { label: 'Category', value: category },
      { label: 'SKU', value: input.sku || 'Generated on save' },
      { label: 'Selling price', value: kes(input.salePrice) },
      ...(input.costPrice != null ? [{ label: 'Cost', value: kes(input.costPrice) }] : []),
      { label: 'Kind', value: `${input.productKind ?? 'storable'} · ${input.productType ?? 'refurbished'}${input.requiresSerial ? ' · serial numbers' : ''}` },
      ...(input.taxRate ? [{ label: 'VAT', value: `${input.taxRate}%` }] : []),
    ]
    return {
      ok: true,
      needsConfirmation: true,
      title: `New product · ${input.name}`,
      lines,
      warnings: warnings.length ? warnings : undefined,
      input: { ...input, category },
      message: `A confirmation card for the product "${input.name}" is shown to the user. Nothing is saved until they click Confirm.${warnings.length ? ` Point out: ${warnings.join('; ')}.` : ''}`,
    }
  },
  confirm: {
    execute: async (_ctx, rawInput): Promise<ConfirmResult> => {
      const result = await publishProduct(toValidated(inputSchema.parse(rawInput)))
      if (result.status === 'exists') return { ok: false, message: `"${result.product.name}" already uses that ${result.field} — nothing was created.` }
      if (result.status === 'error') return { ok: false, message: result.message }
      return {
        ok: true,
        id: result.product.id,
        ref: result.product.sku,
        href: '/inventory',
        message: `Product ${result.product.name} (SKU ${result.product.sku}) added to the catalog with no stock.`,
      }
    },
  },
}
