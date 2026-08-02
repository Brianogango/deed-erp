import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import {
  buildReorderDraftPos,
  onHandFromLocations,
  type ReorderProductLike,
} from '@/lib/inventory/reorder-draft-pos'

export const dynamic = 'force-dynamic'

type BlobProduct = ReorderProductLike & {
  stockQty?: number
  stockByLocation?: Partial<Record<string, number>>
}

type BlobPO = {
  id: string
  ref: string
  status: string
  vendorId: string
  vendorName: string
  date: string
  expectedDate?: string
  lines: Array<Record<string, unknown>>
  subtotal: number
  taxTotal: number
  total: number
  notes?: string
  receiptIds: string[]
}

function uid() {
  return crypto.randomUUID()
}

function addDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

async function nextPoRef(existing: BlobPO[]): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `PO/${year}/`
  let max = 0
  for (const po of existing) {
    if (!po.ref?.startsWith(prefix)) continue
    const n = parseInt(po.ref.slice(prefix.length), 10)
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

/**
 * POST /api/inventory/reorder-pos
 * Creates draft POs for products at/under reorder level.
 * Safe to call manually or from an external scheduler with session auth.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'inventory_officer', 'finance_officer'])
    const body = await request.json().catch(() => ({})) as { dryRun?: boolean }
    const dryRun = !!body.dryRun

    const state = await loadAppState()
    const products = (Array.isArray(state['deed_products']) ? state['deed_products'] : []) as BlobProduct[]
    const purchaseOrders = ([...(Array.isArray(state['deed_purchaseOrders']) ? state['deed_purchaseOrders'] : [])] as BlobPO[])

    const drafts = buildReorderDraftPos(products, (productId) => {
      const p = products.find(x => x.id === productId)
      if (!p) return 0
      if (p.stockByLocation) return onHandFromLocations(p.stockByLocation)
      return Math.max(0, Number(p.stockQty) || 0)
    })

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        draftCount: drafts.length,
        lineCount: drafts.reduce((s, d) => s + d.lines.length, 0),
        drafts,
      })
    }

    if (drafts.length === 0) {
      return NextResponse.json({ ok: true, created: [], message: 'No products at or under reorder level' })
    }

    const created: BlobPO[] = []
    const now = new Date().toISOString()
    for (const draft of drafts) {
      const lines = draft.lines.map(l => {
        const subtotal = Math.round(l.qty * l.unitPrice)
        return {
          id: uid(),
          productId: l.productId,
          productName: l.productName,
          qty: l.qty,
          qtyReceived: 0,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          subtotal,
          requiresSerial: l.requiresSerial,
        }
      })
      const subtotal = lines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0)
      const taxTotal = lines.reduce((s, l) => s + Math.round((Number(l.subtotal) || 0) * ((Number(l.taxRate) || 0) / 100)), 0)
      const po: BlobPO = {
        id: uid(),
        ref: await nextPoRef([...purchaseOrders, ...created]),
        status: 'draft',
        vendorId: draft.vendorId,
        vendorName: draft.vendorName,
        date: now,
        expectedDate: addDays(now, 7),
        lines,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
        notes: draft.notes,
        receiptIds: [],
      }
      created.push(po)
    }

    await saveStoreKeys({
      deed_purchaseOrders: JSON.stringify([...created, ...purchaseOrders]),
    })
    return NextResponse.json({
      ok: true,
      created: created.map(p => ({ id: p.id, ref: p.ref, lineCount: p.lines.length, total: p.total })),
    })
  })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'inventory_officer', 'finance_officer'])
    const state = await loadAppState()
    const products = (Array.isArray(state['deed_products']) ? state['deed_products'] : []) as BlobProduct[]
    const drafts = buildReorderDraftPos(products, (productId) => {
      const p = products.find(x => x.id === productId)
      if (!p) return 0
      if (p.stockByLocation) return onHandFromLocations(p.stockByLocation)
      return Math.max(0, Number(p.stockQty) || 0)
    })
    return NextResponse.json({
      ok: true,
      draftCount: drafts.length,
      lineCount: drafts.reduce((s, d) => s + d.lines.length, 0),
      drafts,
    })
  })
}
