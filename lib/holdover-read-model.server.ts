import 'server-only'

import prisma from '@/lib/prisma'
import type { Holdover as HoldoverRow, Prisma } from '@prisma/client'
import { getRequiredSession } from '@/lib/auth/api'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'

/**
 * Device holdovers (loaners) as the screens use them, read from the holdovers
 * table (the deed_holdovers screen copy is frozen). Issue, extend and return
 * go through /api/holdovers.
 *
 * The fields with a column are kept there; everything else the screen shows
 * (accessories, repair link, extension history, the exact date strings …) is
 * kept in screen_extras. The screen id is blob_id when the holdover came from
 * the copy, else the table id.
 */

type Row = Record<string, any>

/** Screen fields stored in their own column. */
const COLUMN_FIELDS = [
  'id', 'ref', 'clientName', 'clientPhone', 'productId', 'productName', 'serialId', 'serialNumber',
  'deviceCondition', 'purpose', 'status', 'returnCondition', 'issuedByName',
] as const

const text = (v: unknown, max: number) => {
  const s = v == null ? '' : String(v).trim()
  return s ? s.slice(0, max) : null
}
const when = (v: unknown) => {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toScreenHoldover(h: HoldoverRow): Row {
  const extras = h.screenExtras && typeof h.screenExtras === 'object' && !Array.isArray(h.screenExtras)
    ? h.screenExtras as Row
    : {}
  return {
    clientIdNo: '', accessories: '', purposeNote: '', linkedRepairId: '', linkedRepairRef: '',
    returnNotes: '', returnLocation: 'shop', authorizedByUserId: '', authorizedByName: '',
    issuedDate: h.issuedAt?.toISOString() ?? '',
    expectedReturnDate: h.dueAt?.toISOString().slice(0, 10) ?? '',
    returnedDate: h.returnedAt?.toISOString() ?? '',
    createdAt: h.createdAt.toISOString(),
    ...extras,
    id: h.blobId || h.id,
    ref: h.ref,
    clientName: h.customerName ?? '',
    clientPhone: h.customerPhone ?? '',
    productId: h.productId ?? '',
    productName: h.productName ?? '',
    serialId: h.serialId ?? '',
    serialNumber: h.serialNumber ?? '',
    deviceCondition: h.deviceCondition ?? 'good',
    purpose: h.purpose ?? 'other',
    status: h.status,
    returnCondition: h.returnCondition ?? '',
    issuedByName: h.createdBy ?? '',
  }
}

/** Table columns (and screen_extras) for a full screen record or a patch of one. */
export function holdoverData(input: Row, storedExtras?: unknown): Prisma.HoldoverUncheckedUpdateInput {
  const data: Prisma.HoldoverUncheckedUpdateInput = {}
  const has = (k: string) => k in input && input[k] !== undefined
  if (has('clientName')) data.customerName = text(input.clientName, 200)
  if (has('clientPhone')) data.customerPhone = text(input.clientPhone, 40)
  if (has('productId')) data.productId = text(input.productId, 80)
  if (has('productName')) data.productName = text(input.productName, 200)
  if (has('serialId')) data.serialId = text(input.serialId, 80)
  if (has('serialNumber')) data.serialNumber = text(input.serialNumber, 120)
  if (has('deviceCondition')) data.deviceCondition = text(input.deviceCondition, 40)
  if (has('purpose')) data.purpose = text(input.purpose, 40)
  if (has('status')) data.status = text(input.status, 30) ?? 'active'
  if (has('returnCondition')) data.returnCondition = text(input.returnCondition, 40)
  if (has('issuedByName')) data.createdBy = text(input.issuedByName, 80)
  if (has('issuedDate')) data.issuedAt = when(input.issuedDate)
  if (has('expectedReturnDate')) data.dueAt = when(input.expectedReturnDate)
  if (has('returnedDate')) data.returnedAt = when(input.returnedDate)

  const extras: Row = storedExtras && typeof storedExtras === 'object' && !Array.isArray(storedExtras) ? { ...storedExtras as Row } : {}
  for (const [k, v] of Object.entries(input)) {
    if ((COLUMN_FIELDS as readonly string[]).includes(k) || v === undefined) continue
    extras[k] = v
  }
  data.screenExtras = extras as Prisma.InputJsonObject
  return data
}

export async function findHoldoverByScreenId(id: string) {
  return prisma.holdover.findFirst({
    where: /^[0-9a-f-]{36}$/i.test(id) ? { OR: [{ blobId: id }, { id }] } : { blobId: id },
  })
}

/** The next free HOLD/NNNN number, for when the screen's number is already taken. */
export async function nextHoldoverRef(): Promise<string> {
  const refs = await prisma.holdover.findMany({ select: { ref: true } })
  const nums = refs.map(r => parseInt(r.ref.replace(/^(?:HOLD|LOAN)\//, ''), 10)).filter(n => !Number.isNaN(n))
  return `HOLD/${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`
}

/** The same people the deed_holdovers write policy allowed. */
export async function requireHoldoverEditor() {
  const session = await getRequiredSession()
  if (!canWriteStoreKey(session.user, 'deed_holdovers')) {
    const error = new Error('You do not have permission to change holdovers')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
  return session.user
}

export async function loadScreenHoldovers(screenCopy: unknown): Promise<Row[]> {
  const rows = await prisma.holdover.findMany({ orderBy: { createdAt: 'desc' } })
  const out = rows.map(toScreenHoldover)
  const known = new Set(rows.flatMap(r => [r.id, r.blobId, r.ref].filter(Boolean) as string[]))
  for (const h of Array.isArray(screenCopy) ? screenCopy as Row[] : []) {
    if (h?.id && !known.has(String(h.id)) && !known.has(String(h.ref ?? ''))) out.push(h)
  }
  return out
}
