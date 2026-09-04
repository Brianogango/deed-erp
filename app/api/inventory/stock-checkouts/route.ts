import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { normalizePermissionRole } from '@/lib/auth/authorization'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { upsertBulkStock } from '@/lib/business-logic'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const REQUEST_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']
const APPROVE_ROLES = ['director', 'inventory_officer', 'technical_lead']
const SOURCE_LOCATIONS = ['warehouse', 'shop', 'repair_unit']

type CheckoutStatus = 'pending' | 'approved' | 'issued' | 'partially_closed' | 'completed' | 'rejected' | 'cancelled'
type Outcome = 'consumed' | 'returned' | 'exception'
type ProductRow = { id: string; name?: string; sku?: string; stockQty?: number; requiresSerial?: boolean; trackingMethod?: string; isActive?: boolean }
type SerialRow = { id: string; serial: string; productId: string; productName?: string; location?: string; status?: string }
type BulkRow = { productId: string; location: string; qty: number }
type StockMove = { id: string; type: 'out' | 'transfer' | 'return'; productId: string; productName: string; qty: number; reason: string; fromLocation?: string; toLocation?: string; serialNumbers: string[]; date: string; userId: string; documentRef: string }
type Checkout = {
  id: string; ref: string; status: CheckoutStatus; productId: string; productName: string; sku: string
  qty: number; serialIds: string[]; serialNumbers: string[]; sourceLocation: string
  receiverName: string; purpose: string; relatedJob: string; deviceRef: string; deviceSerial: string
  expectedReturnDate: string; notes: string; requestedBy: string; requestedByName: string; requestedAt: string
  approvedBy?: string; approvedAt?: string; issuedBy?: string; issuedAt?: string; rejectionReason?: string
  consumedQty: number; returnedQty: number; exceptionQty: number; closureNotes?: string; closedAt?: string
}

const list = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : []
const sessionName = (user: { name?: string | null; email?: string | null; id: string }) => user.name || user.email || user.id
const isSerialized = (p: ProductRow) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')
const nextRef = (rows: Checkout[]) => `CHK-${String(rows.reduce((n, r) => Math.max(n, Number(r.ref?.split('-').pop()) || 0), 0) + 1).padStart(5, '0')}`
const outstanding = (r: Checkout) => r.qty - r.consumedQty - r.returnedQty - r.exceptionQty

async function auth(approve = false) {
  const session = await getServerSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = normalizePermissionRole(session.user.role)
  const allowed = (approve ? APPROVE_ROLES : REQUEST_ROLES).map(normalizePermissionRole).filter(Boolean)
  if (!role || !allowed.includes(role)) return { error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }) }
  return { session }
}

export async function GET() {
  const access = await auth()
  if ('error' in access) return access.error
  const state = await loadAppStateForWrite(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockCheckouts'])
  const products = list<ProductRow>(state.deed_products).filter(p => p.id && p.name && p.isActive !== false)
  const serials = list<SerialRow>(state.deed_serials)
  const bulk = list<BulkRow>(state.deed_bulkStock)
  const checkouts = list<Checkout>(state.deed_stockCheckouts).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  return NextResponse.json({
    products: products.map(p => ({ id: p.id, name: p.name, sku: p.sku || '', serialized: isSerialized(p) })),
    serials: serials.filter(s => SOURCE_LOCATIONS.includes(String(s.location)) && s.status !== 'sold'),
    bulk,
    checkouts,
    canApprove: APPROVE_ROLES.map(normalizePermissionRole).filter(Boolean).includes(normalizePermissionRole(access.session.user.role) || ''),
    currentUserId: access.session.user.id,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const action = String(body.action || '')
  const access = await auth(action === 'approve' || action === 'reject')
  if ('error' in access) return access.error

  return withAppStateKeyLock('deed_stockCheckouts', async () => {
    const state = await loadAppStateForWrite(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_stockCheckouts'])
    const products = [...list<ProductRow>(state.deed_products)]
    let serials = [...list<SerialRow>(state.deed_serials)]
    let bulk = [...list<BulkRow>(state.deed_bulkStock)]
    const moves = [...list<StockMove>(state.deed_stockMoves)]
    const rows = [...list<Checkout>(state.deed_stockCheckouts)]
    const now = new Date().toISOString()
    let row: Checkout

    if (action === 'request') {
      const product = products.find(p => p.id === String(body.productId || ''))
      const sourceLocation = String(body.sourceLocation || 'warehouse')
      if (!product || !SOURCE_LOCATIONS.includes(sourceLocation)) return NextResponse.json({ error: 'Select a valid product and source location' }, { status: 422 })
      const serialIds = Array.isArray(body.serialIds) ? body.serialIds.map(String) : []
      const qty = isSerialized(product) ? serialIds.length : Math.floor(Number(body.qty) || 0)
      if (qty < 1 || !String(body.receiverName || '').trim() || !String(body.purpose || '').trim()) return NextResponse.json({ error: 'Product, quantity, receiver and purpose are required' }, { status: 422 })
      const reservedRows = rows.filter(r => ['pending', 'approved'].includes(r.status) && r.productId === product.id && r.sourceLocation === sourceLocation)
      if (isSerialized(product)) {
        const reservedIds = new Set(reservedRows.flatMap(r => r.serialIds))
        const selected = serials.filter(s => serialIds.includes(s.id))
        if (selected.length !== qty || selected.some(s => s.productId !== product.id || s.location !== sourceLocation || reservedIds.has(s.id))) return NextResponse.json({ error: 'One or more serials are unavailable or already reserved' }, { status: 409 })
      } else {
        const physical = bulk.filter(x => x.productId === product.id && x.location === sourceLocation).reduce((n, x) => n + Math.max(0, Number(x.qty) || 0), 0)
        const reserved = reservedRows.reduce((n, r) => n + outstanding(r), 0)
        if (physical - reserved < qty) return NextResponse.json({ error: `Only ${Math.max(0, physical - reserved)} unreserved unit(s) available` }, { status: 409 })
      }
      row = { id: randomUUID(), ref: nextRef(rows), status: 'pending', productId: product.id, productName: product.name || 'Product', sku: product.sku || '', qty, serialIds, serialNumbers: serials.filter(s => serialIds.includes(s.id)).map(s => s.serial), sourceLocation, receiverName: String(body.receiverName).trim(), purpose: String(body.purpose).trim(), relatedJob: String(body.relatedJob || ''), deviceRef: String(body.deviceRef || ''), deviceSerial: String(body.deviceSerial || ''), expectedReturnDate: String(body.expectedReturnDate || ''), notes: String(body.notes || ''), requestedBy: access.session.user.id, requestedByName: sessionName(access.session.user), requestedAt: now, consumedQty: 0, returnedQty: 0, exceptionQty: 0 }
      rows.unshift(row)
    } else {
      const index = rows.findIndex(r => r.id === String(body.id || ''))
      if (index < 0) return NextResponse.json({ error: 'Checkout request not found' }, { status: 404 })
      row = { ...rows[index] }
      if (action === 'approve' || action === 'reject') {
        if (row.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be reviewed' }, { status: 409 })
        if (row.requestedBy === access.session.user.id) return NextResponse.json({ error: 'The requester cannot approve or reject their own checkout' }, { status: 409 })
        row.status = action === 'approve' ? 'approved' : 'rejected'; row.approvedBy = access.session.user.id; row.approvedAt = now; row.rejectionReason = action === 'reject' ? String(body.reason || '') : undefined
      } else if (action === 'issue') {
        if (row.status !== 'approved') return NextResponse.json({ error: 'Only approved requests can be issued' }, { status: 409 })
        const product = products.find(p => p.id === row.productId)
        if (!product) return NextResponse.json({ error: 'Product no longer exists' }, { status: 409 })
        if (isSerialized(product)) {
          const selected = serials.filter(s => row.serialIds.includes(s.id))
          if (selected.length !== row.qty || selected.some(s => s.location !== row.sourceLocation)) return NextResponse.json({ error: 'Reserved serial stock is no longer available' }, { status: 409 })
          const ids = new Set(row.serialIds); serials = serials.map(s => ids.has(s.id) ? { ...s, location: 'employee', status: 'assigned' } : s)
        } else {
          const available = bulk.filter(x => x.productId === row.productId && x.location === row.sourceLocation).reduce((n, x) => n + Math.max(0, Number(x.qty) || 0), 0)
          if (available < row.qty) return NextResponse.json({ error: `Only ${available} unit(s) remain at the source` }, { status: 409 })
          bulk = upsertBulkStock(bulk as never, row.productId, row.sourceLocation as never, -row.qty) as never
        }
        const pi = products.findIndex(p => p.id === row.productId); if (pi >= 0) products[pi] = { ...products[pi], stockQty: Math.max(0, Number(products[pi].stockQty || 0) - row.qty) }
        row.status = 'issued'; row.issuedBy = access.session.user.id; row.issuedAt = now
        moves.unshift({ id: randomUUID(), type: 'out', productId: row.productId, productName: row.productName, qty: row.qty, reason: `Stock checkout · ${row.ref} · ${row.purpose}`, fromLocation: row.sourceLocation, toLocation: 'employee', serialNumbers: row.serialNumbers, date: now.slice(0, 10), userId: access.session.user.id, documentRef: row.ref })
      } else if (action === 'close') {
        if (!['issued', 'partially_closed'].includes(row.status)) return NextResponse.json({ error: 'Only issued checkouts can be closed' }, { status: 409 })
        const outcome = String(body.outcome || '') as Outcome
        const qty = Math.floor(Number(body.qty) || 0)
        if (!['consumed', 'returned', 'exception'].includes(outcome) || qty < 1 || qty > outstanding(row)) return NextResponse.json({ error: 'Enter a valid outcome and quantity within the outstanding balance' }, { status: 422 })
        const product = products.find(p => p.id === row.productId)
        const outcomeSerialIds = Array.isArray(body.serialIds) ? body.serialIds.map(String) : []
        const alreadyClosed = new Set((row as Checkout & { closedSerialIds?: string[] }).closedSerialIds || [])
        if (product && isSerialized(product)) {
          if (outcomeSerialIds.length !== qty || outcomeSerialIds.some(id => !row.serialIds.includes(id) || alreadyClosed.has(id))) return NextResponse.json({ error: 'Select the serials being closed' }, { status: 422 })
          const ids = new Set(outcomeSerialIds)
          serials = serials.map(s => ids.has(s.id) ? { ...s, location: outcome === 'returned' ? row.sourceLocation : outcome === 'exception' ? 'quarantine' : 'customer', status: outcome === 'returned' ? 'available' : outcome === 'exception' ? 'under_repair' : 'written_off' } : s)
          ;(row as Checkout & { closedSerialIds?: string[] }).closedSerialIds = [...alreadyClosed, ...outcomeSerialIds]
        }
        if (outcome === 'returned') {
          if (!product || !isSerialized(product)) bulk = upsertBulkStock(bulk as never, row.productId, row.sourceLocation as never, qty) as never
          const pi = products.findIndex(p => p.id === row.productId); if (pi >= 0) products[pi] = { ...products[pi], stockQty: Number(products[pi].stockQty || 0) + qty }
          moves.unshift({ id: randomUUID(), type: 'return', productId: row.productId, productName: row.productName, qty, reason: `Checkout return · ${row.ref}`, fromLocation: 'employee', toLocation: row.sourceLocation, serialNumbers: serials.filter(s => outcomeSerialIds.includes(s.id)).map(s => s.serial), date: now.slice(0, 10), userId: access.session.user.id, documentRef: row.ref })
        }
        row.consumedQty += outcome === 'consumed' ? qty : 0; row.returnedQty += outcome === 'returned' ? qty : 0; row.exceptionQty += outcome === 'exception' ? qty : 0
        row.closureNotes = [row.closureNotes, String(body.notes || '')].filter(Boolean).join('\n'); row.closedAt = outstanding(row) === 0 ? now : undefined; row.status = outstanding(row) === 0 ? 'completed' : 'partially_closed'
      } else return NextResponse.json({ error: 'Invalid checkout action' }, { status: 400 })
      rows[index] = row
    }

    await saveStoreKeys({ deed_products: JSON.stringify(products), deed_serials: JSON.stringify(serials), deed_bulkStock: JSON.stringify(bulk), deed_stockMoves: JSON.stringify(moves), deed_stockCheckouts: JSON.stringify(rows) })
    await writeFinancialAudit({ userId: access.session.user.id, action: `stock_checkout_${action}`, entityType: 'stock_checkout', entityId: row.id, newValues: row }).catch(() => {})
    return NextResponse.json({ ok: true, checkout: row })
  })
}
