// Bulk data import — accepts JSON arrays for any store key.
// Used to seed products, contacts, etc. from external sources.
// POST body: { "deed_products": [...], "deed_contacts": [...] }
// Merges by id (upsert) to avoid duplicates.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { preservePostedInvoicePaymentProgress } from '@/lib/finance-invoice'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'

type AnyRecord = Record<string, unknown>

function mergeById(existing: AnyRecord[], incoming: AnyRecord[]): AnyRecord[] {
  const map = new Map<string, AnyRecord>()
  for (const item of existing) map.set(String(item.id ?? ''), item)
  for (const item of incoming) {
    const id = String(item.id ?? `import_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    map.set(id, { ...map.get(id), ...item, id })
  }
  return Array.from(map.values())
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

function productIdentity(item: AnyRecord) {
  return {
    name: norm(item.name),
    sku: norm(item.sku),
    barcode: norm(item.barcode),
  }
}

function mergeProductsWithoutDuplicates(existing: AnyRecord[], incoming: AnyRecord[]) {
  const merged = [...existing]
  const seenNames = new Set(existing.map(p => productIdentity(p).name).filter(Boolean))
  const seenSkus = new Set(existing.map(p => productIdentity(p).sku).filter(Boolean))
  const seenBarcodes = new Set(existing.map(p => productIdentity(p).barcode).filter(Boolean))
  let imported = 0
  let skipped = 0

  for (const item of incoming) {
    const ident = productIdentity(item)
    const duplicate =
      (ident.name && seenNames.has(ident.name)) ||
      (ident.sku && seenSkus.has(ident.sku)) ||
      (ident.barcode && seenBarcodes.has(ident.barcode))
    if (duplicate) {
      skipped++
      continue
    }

    const id = String(item.id ?? `import_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    const next = { ...item, id }
    merged.push(next)
    if (ident.name) seenNames.add(ident.name)
    if (ident.sku) seenSkus.add(ident.sku)
    if (ident.barcode) seenBarcodes.add(ident.barcode)
    imported++
  }

  return { merged, imported, skipped }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Director only
  if (session.user.role !== 'director') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  let body: Record<string, unknown> | null = null
  try { body = await request.json() } catch {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected object of { storeKey: item[] }' }, { status: 400 })
  }

  const ALLOWED_KEYS = new Set([
    'deed_products', 'deed_contacts', 'deed_saleOrders', 'deed_purchaseOrders',
    'deed_repairs', 'deed_employees', 'deed_warranties', 'deed_serials',
    'deed_kilimallOrders', 'deed_expenses', 'deed_invoices',
  ])

  const state   = await loadAppState()
  const updates: Record<string, string> = {}
  const summary: Record<string, { imported: number; skipped: number; total: number }> = {}

  for (const [key, incoming] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) continue
    if (!Array.isArray(incoming)) continue

    const existing = Array.isArray(state[key]) ? (state[key] as AnyRecord[]) : []
    const result = key === 'deed_products'
      ? mergeProductsWithoutDuplicates(existing, incoming as AnyRecord[])
      : { merged: mergeById(existing, incoming as AnyRecord[]), imported: (incoming as AnyRecord[]).length, skipped: 0 }
    // Re-importing an older invoices file must not take payments away:
    // amountPaid and the payment list never go down through an import.
    const merged = key === 'deed_invoices'
      ? preservePostedInvoicePaymentProgress(existing, result.merged) as AnyRecord[]
      : result.merged
    updates[key]   = JSON.stringify(merged)
    summary[key]   = { imported: result.imported, skipped: result.skipped, total: merged.length }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid keys provided' }, { status: 422 })
  }

  try {
    await saveStoreKeys(updates)
  } catch (err) {
    // e.g. the bulk-delete guard refusing a save that would drop records.
    console.error('[import] save failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import could not be saved' }, { status: 409 })
  }

  // Posted opening invoices/bills must create Prisma journals so TB stays truthful.
  let journalsPosted = 0
  if (updates.deed_invoices) {
    try {
      const { postInvoiceJournalToPrisma } = await import('@/lib/accounting/invoice-journals')
      // Only the documents in this request. Re-posting every posted invoice
      // in the ledger made each import hundreds of journal writes long (and
      // retried old documents' journals).
      const incomingIds = new Set((Array.isArray(body.deed_invoices) ? body.deed_invoices as AnyRecord[] : []).map(inv => String(inv.id ?? '')))
      const invoices = (JSON.parse(updates.deed_invoices) as Array<Record<string, unknown>>)
        .filter(inv => incomingIds.has(String(inv.id ?? '')))
      const posted = invoices.filter(inv => {
        const status = String(inv.status || '')
        return status === 'posted' || status === 'approved' || status === 'paid' || status === 'partially_paid'
      })
      const prisma = (await import('@/lib/prisma')).default
      for (const inv of posted) {
        try {
          // Already on the ledger: re-importing it again used to post another
          // copy (JRN/INV/<ref>/2, /3, …) each time, multiplying the revenue.
          // Bills post with source 'bill', invoices with 'invoice'.
          const live = await prisma.journalEntry.findMany({
            where: { invoiceId: String(inv.id), sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null },
            select: { ref: true },
          }).catch(() => [] as Array<{ ref: string }>)
          const number = String(inv.ref || inv.invoiceNumber || '')
          if (live.some(j => isPostingRef(j.ref, number))) continue
          await postInvoiceJournalToPrisma({
            id: String(inv.id),
            ref: String(inv.ref || inv.invoiceNumber || inv.id),
            invoiceNumber: String(inv.ref || inv.invoiceNumber || ''),
            type: inv.type === 'vendor_bill' ? 'vendor_bill' : 'customer_invoice',
            purchaseOrderId: typeof inv.purchaseOrderId === 'string' ? inv.purchaseOrderId : undefined,
            partnerName: typeof inv.partnerName === 'string' ? inv.partnerName : undefined,
            totalAmount: Number(inv.total ?? inv.totalAmount ?? 0),
            subtotal: Number(inv.subtotal ?? inv.total ?? 0),
            taxAmount: Number(inv.taxTotal ?? inv.taxAmount ?? 0),
            lines: Array.isArray(inv.lines) ? inv.lines as any[] : [],
          })
          journalsPosted++
        } catch (err) {
          console.error('[import] invoice journal failed:', inv.id, err)
        }
      }
    } catch (err) {
      console.error('[import] journal pass failed:', err)
    }
  }

  return NextResponse.json({ ok: true, summary, journalsPosted })
}
