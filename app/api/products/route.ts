import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { productSchema, validate } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export type ApiProduct = {
  id: string; name: string; sku: string; category: string
  salePrice: number; costPrice: number; taxRate: number; stockQty: number
  minStock: number; unit: string; description?: string | null
  requiresSerial: boolean; warrantyMonths: number
  canBeSold: boolean; canBePurchased: boolean; isActive: boolean; createdAt: string
}

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

async function findProductDuplicate(sku: string, barcode?: string | null) {
  return prisma.product.findFirst({
    where: {
      OR: [
        { sku: { equals: sku, mode: 'insensitive' } },
        ...(barcode ? [{ barcode: { equals: barcode, mode: 'insensitive' } }] : []),
      ],
    },
    select: { id: true, name: true, sku: true, barcode: true },
  })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const products = await prisma.product.findMany({
      include: { 
        serials: true,
        category: true,
        taxRate: true,
      },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(products)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 })
    }

    // Validate input using Zod schema
    const validated = await validate(productSchema, {
      ...body,
      salePrice: Number(body.salePrice ?? body.sellingPrice ?? 0),
      costPrice: Number(body.costPrice ?? 0),
      minStock: Number(body.minStock ?? body.reorderLevel ?? 5),
      taxRate: Number(body.taxRate ?? 16),
    })

    const duplicate = await findProductDuplicate(validated.sku, validated.barcode)
    if (duplicate) {
      const field = duplicate.sku.toLowerCase() === validated.sku.toLowerCase() ? 'SKU' : 'barcode'
      const value = field === 'SKU' ? validated.sku : validated.barcode
      return NextResponse.json(
        { error: `${field} "${value}" is already used by "${duplicate.name}"` },
        { status: 409 },
      )
    }

    // Handle category: if it's a human-readable string, find or create the category
    let categoryId: string | undefined
    if (validated.category && validated.category.length !== 36) {
      // It's a human-readable category name, find or create it
      let category = await prisma.category.findFirst({
        where: { name: validated.category, isActive: true },
      })
      if (!category) {
        category = await prisma.category.create({
          data: { name: validated.category, isActive: true },
        })
      }
      categoryId = category.id
    } else if (validated.category && validated.category.length === 36) {
      // It's already a UUID
      categoryId = validated.category
    }

    // Handle tax rate: if it's a number, find or create a tax rate
    let taxRateId: string | undefined
    if (body.taxRate !== undefined) {
      const taxRateNum = Number(body.taxRate ?? 16)
      let taxRate = await prisma.taxRate.findFirst({
        where: { rate: taxRateNum.toString(), isActive: true },
      })
      if (!taxRate) {
        taxRate = await prisma.taxRate.create({
          data: { 
            name: `${taxRateNum}% VAT`,
            rate: taxRateNum.toString(),
            taxType: 'vat',
            isActive: true,
          },
        })
      }
      taxRateId = taxRate.id
    }

    // Map to Prisma schema - preserve all provided fields
    const data: any = {
      name: validated.name,
      sku: validated.sku,
      barcode: validated.barcode || null,
      description: validated.description || null,
      shortDescription: body.shortDescription || null,
      sellingPrice: validated.salePrice,
      costPrice: validated.costPrice,
      reorderLevel: validated.minStock,
      trackStock: validated.trackStock,
      categoryId: categoryId,
      taxRateId: taxRateId,
      // Additional fields from Inventory form
      modelNumber: body.modelNumber || null,
      specs: body.specs || {},
      primaryImageUrl: body.image || null, // Map emoji/URL to primaryImageUrl
      isActive: body.isActive !== false,
    }

    // Add warranty months if provided (store as JSON in specs for now)
    if (body.warrantyMonths !== undefined) {
      data.specs = { ...data.specs, warrantyMonths: Number(body.warrantyMonths) }
    }

    // Add account mapping to specs if provided
    if (body.saleAccountCode || body.costAccountCode || body.inventoryAccountCode || body.cogsAccountCode) {
      data.specs = {
        ...data.specs,
        accountMapping: {
          saleAccountCode: body.saleAccountCode || null,
          costAccountCode: body.costAccountCode || null,
          inventoryAccountCode: body.inventoryAccountCode || null,
          cogsAccountCode: body.cogsAccountCode || null,
          adjustmentAccountCode: body.adjustmentAccountCode || null,
          writeOffAccountCode: body.writeOffAccountCode || null,
        }
      }
    }

    const product = await prisma.product.create({ 
      data,
      include: {
        category: true,
        taxRate: true,
      }
    })
    
    return NextResponse.json(
      {
        ...product,
        salePrice: Number(product.sellingPrice),
        minStock: product.reorderLevel ?? 0,
        stockQty: 0,
        category: product.category?.name || validated.category,
        taxRate: product.taxRate?.rate ? Number(product.taxRate.rate) : 16,
      },
      { status: 201 },
    )
  })
}
