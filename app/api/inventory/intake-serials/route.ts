import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getServerSession } from '@/lib/auth/server'
import { normalizePermissionRole } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { buildInventoryBarcode } from '@/lib/inventory-identifiers'
import {
  nextIntakeDocumentRef,
  parseSerialList,
  resolveIntakeKind,
  validateSerialIntakeInput,
  type SerialIntakeKind,
} from '@/lib/inventory/serial-intake'
import { isOpeningStockLocked } from '@/lib/inventory/opening-stock'
import prisma from '@/lib/prisma'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

type BlobSerial = {
  id: string
  serial: string
  productId: string
  productName: string
  sku?: string
  location: string
  status: string
  receivedDate: string
  barcode: string
  accessoryNotes?: string
}

type BlobProduct = {
  id: string
  name?: string
  sku?: string
  stockQty?: number
  requiresSerial?: boolean
  trackingMethod?: string
}

type BlobMove = {
  id: string
  type: string
  productId: string
  productName: string
  qty: number
  reason: string
  fromLocation?: string
  toLocation?: string
  serialNumbers: string[]
  date: string
  userId: string
  documentRef: string
}

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * POST /api/inventory/intake-serials
 * Authoritative on-hand serial intake for a single product.
 * Writes deed_serials + deed_stockMoves; optionally mirrors Prisma serial_numbers.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizePermissionRole(session.user.role)
  const allowed = ALLOWED_ROLES.map(item => normalizePermissionRole(item)).filter(Boolean)
  if (!role || !allowed.includes(role)) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    productId?: string
    serials?: string[] | string
    location?: string
    reason?: string
    kind?: SerialIntakeKind
  } | null

  if (!body?.productId) {
    return NextResponse.json({ error: 'productId is required' }, { status: 400 })
  }

  const serialTokens = Array.isArray(body.serials)
    ? body.serials.map(s => String(s).trim()).filter(Boolean)
    : parseSerialList(String(body.serials ?? ''))

  const state = await loadAppState(['deed_serials', 'deed_products', 'deed_stockMoves', 'deed_openingStockPosted'])
  const existingSerials = (Array.isArray(state.deed_serials) ? state.deed_serials : []) as BlobSerial[]
  const products = (Array.isArray(state.deed_products) ? state.deed_products : []) as BlobProduct[]
  const stockMoves = (Array.isArray(state.deed_stockMoves) ? state.deed_stockMoves : []) as BlobMove[]
  const openingStockPosted = isOpeningStockLocked(
    state.deed_openingStockPosted === true,
    stockMoves,
  )

  const product = products.find(p => p.id === body.productId)
  if (!product) {
    return NextResponse.json({ error: 'Product not found in catalog' }, { status: 404 })
  }

  // Allow intake on SERIAL products, or on products that should be serial-tracked
  // (e.g. laptops created before tracking was set). We flip tracking on write.
  const validation = validateSerialIntakeInput({
    productId: body.productId,
    serials: serialTokens,
    location: body.location,
    reason: body.reason,
    existingSerials,
  })
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 422 })
  }

  const kind = resolveIntakeKind(openingStockPosted, body.kind)
  const docRef = nextIntakeDocumentRef(stockMoves.map(m => m.documentRef))
  const receivedDate = todayLocal()
  const reasonLabel = kind === 'opening_balance'
    ? `Opening balance: ${validation.reason}`
    : `Stock intake: ${validation.reason}`

  const batchBarcodes: string[] = []
  const finalCreated: BlobSerial[] = validation.serials.map(serial => {
    const barcode = buildInventoryBarcode({
      existingBarcodes: [
        ...existingSerials.map(s => s.barcode),
        ...batchBarcodes,
      ],
      manufacturerSerial: serial,
      productSku: product.sku || product.id,
    })
    batchBarcodes.push(barcode)
    return {
      id: randomUUID(),
      serial,
      productId: product.id,
      productName: product.name || 'Product',
      sku: product.sku,
      location: validation.location,
      status: 'available',
      receivedDate,
      barcode,
      accessoryNotes: reasonLabel,
    }
  })

  const nextSerials = [...finalCreated, ...existingSerials]
  const move: BlobMove = {
    id: randomUUID(),
    type: 'in',
    productId: product.id,
    productName: product.name || 'Product',
    qty: finalCreated.length,
    reason: reasonLabel,
    toLocation: validation.location,
    serialNumbers: finalCreated.map(s => s.serial),
    date: receivedDate,
    userId: session.user.id,
    documentRef: docRef,
  }
  const nextMoves = [move, ...stockMoves]

  const nextProducts = products.map(p => {
    if (p.id !== product.id) return p
    return {
      ...p,
      requiresSerial: true,
      trackingMethod: 'SERIAL',
      stockQty: Number(p.stockQty ?? 0) + finalCreated.length,
    }
  })

  await saveStoreKeys({
    deed_serials: JSON.stringify(nextSerials),
    deed_stockMoves: JSON.stringify(nextMoves),
    deed_products: JSON.stringify(nextProducts),
  })

  // Best-effort Prisma mirror (UI qty uses deed_serials).
  try {
    const prismaProduct = await prisma.product.findUnique({ where: { id: product.id }, select: { id: true } }).catch(() => null)
    if (prismaProduct) {
      await prisma.product.update({
        where: { id: product.id },
        data: { trackingMethod: 'SERIAL', trackStock: true },
      }).catch(() => {})
      for (const row of finalCreated) {
        await prisma.serialNumber.create({
          data: {
            id: row.id,
            blobId: row.id,
            productId: product.id,
            serialNumber: row.serial,
            inventoryBarcode: row.barcode,
            status: 'available',
            location: validation.location,
            productName: product.name?.slice(0, 200) ?? null,
            receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
            notes: reasonLabel,
          },
        }).catch(() => { /* unique conflict — blob is SoR */ })
      }
    }
  } catch {
    /* Prisma mirror is optional */
  }

  await writeFinancialAudit({
    userId: session.user.id,
    action: 'serial_intake',
    entityType: 'product',
    entityId: product.id,
    newValues: {
      documentRef: docRef,
      kind,
      location: validation.location,
      count: finalCreated.length,
      serials: finalCreated.map(s => s.serial),
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    documentRef: docRef,
    kind,
    location: validation.location,
    added: finalCreated.length,
    serials: finalCreated,
    move,
    product: {
      id: product.id,
      name: product.name,
      requiresSerial: true,
      trackingMethod: 'SERIAL',
      stockQty: Number(product.stockQty ?? 0) + finalCreated.length,
    },
  })
}
