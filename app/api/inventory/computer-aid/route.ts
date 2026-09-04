import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { normalizePermissionRole } from '@/lib/permissions'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { upsertBulkStock } from '@/lib/business-logic'
import { writeFinancialAudit } from '@/lib/accounting/audit'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']
const CA_LOCATION = 'computer_aid'
const CA_COLLECTED = 'computer_aid_collected'
const CA_ISSUES = 'computer_aid_issues'

type CustodyStatus = 'in_custody' | 'collected' | 'with_issues' | 'returned'
type CustodyAction = 'direct_entry' | 'transfer_in' | 'collection' | 'issue' | 'return'

type ProductRow = {
  id: string
  name?: string
  sku?: string
  barcode?: string
  stockQty?: number
  requiresSerial?: boolean
  trackingMethod?: string
}

type SerialRow = {
  id: string
  serial: string
  productId: string
  productName?: string
  sku?: string
  barcode?: string
  location?: string
  status?: string
  receivedDate?: string
  accessoryNotes?: string
  specs?: string
}

type BulkRow = { productId: string; location: string; qty: number }

type StockMove = {
  id: string
  type: 'in' | 'out' | 'transfer' | 'adjustment' | 'return'
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

type CustodyMovement = {
  id: string
  ref: string
  action: CustodyAction
  status: CustodyStatus
  date: string
  productId: string
  productName: string
  qty: number
  serialIds: string[]
  serialNumbers: string[]
  fromLocation?: string
  toLocation: string
  project?: string
  source?: string
  deliveryRef?: string
  condition?: string
  specifications?: string
  storageBin?: string
  receivedBy?: string
  computerAidContact?: string
  collectorName?: string
  collectorId?: string
  collectorPhone?: string
  vehicleDetails?: string
  destination?: string
  releasedBy?: string
  exceptionType?: string
  responsiblePerson?: string
  resolution?: string
  notes?: string
  supportingDocumentName?: string
  createdBy: string
  createdAt: string
  reversedMovementId?: string
}

const today = () => new Date().toISOString().slice(0, 10)
const normalizeSerials = (value: unknown) =>
  (Array.isArray(value) ? value : String(value ?? '').split(/[\n,;]+/))
    .map(item => String(item).trim())
    .filter(Boolean)

function nextRef(action: CustodyAction, movements: CustodyMovement[]) {
  const prefix: Record<CustodyAction, string> = {
    direct_entry: 'CA-IN',
    transfer_in: 'CA-TR',
    collection: 'CA-COL',
    issue: 'CA-EX',
    return: 'CA-RET',
  }
  const max = movements.reduce((value, row) => {
    if (!row.ref?.startsWith(prefix[action])) return value
    const parsed = Number(row.ref.split('-').pop())
    return Number.isFinite(parsed) ? Math.max(value, parsed) : value
  }, 0)
  return `${prefix[action]}-${String(max + 1).padStart(4, '0')}`
}

async function requireUser() {
  const session = await getServerSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = normalizePermissionRole(session.user.role)
  const allowed = ALLOWED_ROLES.map(normalizePermissionRole).filter(Boolean)
  if (!role || !allowed.includes(role)) {
    return { error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }) }
  }
  return { session }
}

function locationQty(serials: SerialRow[], bulk: BulkRow[], location: string) {
  const serialQty = serials.filter(row => row.location === location && row.status !== 'sold').length
  const bulkQty = bulk
    .filter(row => row.location === location)
    .reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0)
  return serialQty + bulkQty
}

export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const state = await loadAppStateForWrite([
    'deed_products',
    'deed_serials',
    'deed_bulkStock',
    'deed_computerAidMovements',
  ])
  const products = (Array.isArray(state.deed_products) ? state.deed_products : []) as ProductRow[]
  const serials = (Array.isArray(state.deed_serials) ? state.deed_serials : []) as SerialRow[]
  const bulk = (Array.isArray(state.deed_bulkStock) ? state.deed_bulkStock : []) as BulkRow[]
  const movements = (Array.isArray(state.deed_computerAidMovements)
    ? state.deed_computerAidMovements
    : []) as CustodyMovement[]

  const custodySerials = serials
    .filter(row => [CA_LOCATION, CA_ISSUES].includes(String(row.location)))
    .map(row => ({
      ...row,
      productName: row.productName || products.find(product => product.id === row.productId)?.name || 'Product',
    }))

  const custodyBulk = bulk
    .filter(row => [CA_LOCATION, CA_ISSUES].includes(String(row.location)) && Number(row.qty) > 0)
    .map(row => ({
      ...row,
      productName: products.find(product => product.id === row.productId)?.name || 'Product',
      sku: products.find(product => product.id === row.productId)?.sku || '',
    }))

  return NextResponse.json({
    summary: {
      inCustody: locationQty(serials, bulk, CA_LOCATION),
      collected: movements.filter(row => row.status === 'collected').reduce((sum, row) => sum + row.qty, 0),
      exceptions: locationQty(serials, bulk, CA_ISSUES),
    },
    products: products
      .filter(product => product.id && product.name)
      .map(product => ({
        id: product.id,
        name: product.name,
        sku: product.sku || '',
        requiresSerial: Boolean(product.requiresSerial || product.trackingMethod === 'SERIAL'),
      })),
    serials: serials.filter(row => ['warehouse', CA_LOCATION].includes(String(row.location)) && row.status !== 'sold'),
    custodySerials,
    custodyBulk,
    movements: movements.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const action = String(body.action || '') as CustodyAction
  if (!['direct_entry', 'transfer_in', 'collection', 'issue', 'return'].includes(action)) {
    return NextResponse.json({ error: 'Invalid custody action' }, { status: 400 })
  }

  return withAppStateKeyLock('deed_computerAidMovements', async () => {
    const state = await loadAppStateForWrite([
      'deed_products',
      'deed_serials',
      'deed_bulkStock',
      'deed_stockMoves',
      'deed_computerAidMovements',
    ])
    const products = (Array.isArray(state.deed_products) ? [...state.deed_products] : []) as ProductRow[]
    let serials = (Array.isArray(state.deed_serials) ? [...state.deed_serials] : []) as SerialRow[]
    let bulk = (Array.isArray(state.deed_bulkStock) ? [...state.deed_bulkStock] : []) as BulkRow[]
    const stockMoves = (Array.isArray(state.deed_stockMoves) ? [...state.deed_stockMoves] : []) as StockMove[]
    const movements = (Array.isArray(state.deed_computerAidMovements)
      ? [...state.deed_computerAidMovements]
      : []) as CustodyMovement[]

    const productId = String(body.productId || '')
    const product = products.find(row => row.id === productId)
    if (!product) return NextResponse.json({ error: 'Select a valid product' }, { status: 422 })

    const requiresSerial = Boolean(product.requiresSerial || product.trackingMethod === 'SERIAL')
    const requestedSerialIds = normalizeSerials(body.serialIds)
    const enteredSerialNumbers = normalizeSerials(body.serialNumbers)
    const qty = requiresSerial
      ? (action === 'direct_entry' ? enteredSerialNumbers.length : requestedSerialIds.length)
      : Math.max(0, Math.floor(Number(body.qty) || 0))
    if (qty < 1) {
      return NextResponse.json({
        error: requiresSerial ? 'Select or enter at least one serial number' : 'Quantity must be greater than zero',
      }, { status: 422 })
    }

    let fromLocation: string | undefined
    let toLocation = CA_LOCATION
    let serialNumbers: string[] = []
    let serialIds: string[] = []
    let stockType: StockMove['type'] = 'transfer'

    if (action === 'direct_entry') {
      stockType = 'in'
      if (requiresSerial) {
        const existing = new Set(serials.map(row => row.serial.trim().toLowerCase()))
        const duplicates = enteredSerialNumbers.filter(value => existing.has(value.toLowerCase()))
        if (duplicates.length) {
          return NextResponse.json({ error: `Serial already exists: ${duplicates[0]}` }, { status: 409 })
        }
        const created = enteredSerialNumbers.map(serial => ({
          id: randomUUID(),
          serial,
          productId,
          productName: product.name || 'Product',
          sku: product.sku,
          barcode: `CA-${serial.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`,
          location: CA_LOCATION,
          status: 'available',
          receivedDate: String(body.date || today()),
          accessoryNotes: `Computer Aid custody · ${String(body.project || 'General')}`,
          specs: String(body.specifications || ''),
        }))
        serials = [...created, ...serials]
        serialIds = created.map(row => row.id)
        serialNumbers = created.map(row => row.serial)
      } else {
        bulk = upsertBulkStock(bulk, productId, CA_LOCATION as never, qty)
      }
    } else {
      fromLocation = action === 'transfer_in' ? 'warehouse' : CA_LOCATION
      toLocation = action === 'collection'
        ? CA_COLLECTED
        : action === 'issue'
          ? CA_ISSUES
          : 'warehouse'

      if (requiresSerial) {
        const selected = serials.filter(row => requestedSerialIds.includes(row.id))
        if (selected.length !== qty || selected.some(row => row.productId !== productId || row.location !== fromLocation)) {
          return NextResponse.json({ error: 'One or more selected serials are no longer available at the source location' }, { status: 409 })
        }
        const selectedIds = new Set(selected.map(row => row.id))
        serials = serials.map(row => selectedIds.has(row.id) ? { ...row, location: toLocation } : row)
        serialIds = selected.map(row => row.id)
        serialNumbers = selected.map(row => row.serial)
      } else {
        const available = bulk
          .filter(row => row.productId === productId && row.location === fromLocation)
          .reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0)
        if (available < qty) {
          return NextResponse.json({ error: `Only ${available} unit(s) available at the source location` }, { status: 409 })
        }
        bulk = upsertBulkStock(bulk, productId, fromLocation as never, -qty)
        bulk = upsertBulkStock(bulk, productId, toLocation as never, qty)
      }

      if (action === 'transfer_in' || action === 'return') {
        const productIndex = products.findIndex(row => row.id === productId)
        if (productIndex >= 0) {
          const delta = action === 'transfer_in' ? -qty : qty
          products[productIndex] = {
            ...products[productIndex],
            stockQty: Math.max(0, Number(products[productIndex].stockQty || 0) + delta),
          }
        }
      }
    }

    const ref = nextRef(action, movements)
    const status: CustodyStatus = action === 'collection'
      ? 'collected'
      : action === 'issue'
        ? 'with_issues'
        : action === 'return'
          ? 'returned'
          : 'in_custody'
    const date = String(body.date || today())
    const movement: CustodyMovement = {
      id: randomUUID(),
      ref,
      action,
      status,
      date,
      productId,
      productName: product.name || 'Product',
      qty,
      serialIds,
      serialNumbers,
      fromLocation,
      toLocation,
      project: String(body.project || ''),
      source: String(body.source || ''),
      deliveryRef: String(body.deliveryRef || ''),
      condition: String(body.condition || ''),
      specifications: String(body.specifications || ''),
      storageBin: String(body.storageBin || ''),
      receivedBy: String(body.receivedBy || ''),
      computerAidContact: String(body.computerAidContact || ''),
      collectorName: String(body.collectorName || ''),
      collectorId: String(body.collectorId || ''),
      collectorPhone: String(body.collectorPhone || ''),
      vehicleDetails: String(body.vehicleDetails || ''),
      destination: String(body.destination || ''),
      releasedBy: String(body.releasedBy || ''),
      exceptionType: String(body.exceptionType || ''),
      responsiblePerson: String(body.responsiblePerson || ''),
      resolution: String(body.resolution || ''),
      notes: String(body.notes || ''),
      supportingDocumentName: String(body.supportingDocumentName || ''),
      createdBy: auth.session.user.id,
      createdAt: new Date().toISOString(),
    }

    const stockMove: StockMove = {
      id: randomUUID(),
      type: stockType,
      productId,
      productName: product.name || 'Product',
      qty,
      reason: `Computer Aid custody · ${ref}`,
      fromLocation,
      toLocation,
      serialNumbers,
      date,
      userId: auth.session.user.id,
      documentRef: ref,
    }

    await saveStoreKeys({
      deed_products: JSON.stringify(products),
      deed_serials: JSON.stringify(serials),
      deed_bulkStock: JSON.stringify(bulk),
      deed_stockMoves: JSON.stringify([stockMove, ...stockMoves]),
      deed_computerAidMovements: JSON.stringify([movement, ...movements]),
    })

    await writeFinancialAudit({
      userId: auth.session.user.id,
      action: `computer_aid_${action}`,
      entityType: 'inventory_custody',
      entityId: movement.id,
      newValues: movement,
    }).catch(() => {})

    return NextResponse.json({ ok: true, movement })
  })
}
