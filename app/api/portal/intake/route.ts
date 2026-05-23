import { NextRequest, NextResponse } from 'next/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { RepairOrder } from '@/lib/store'

const REPAIR_STORE_KEY = 'deed_repairs_v2'
const WAIVER_TEXT = 'I authorise Deed to proceed with direct repair work and acknowledge that customer-caused damage, liquid damage, previous tampering, or unavailable parts may affect warranty coverage and repair outcome.'

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

function nextRepairRef(existing: RepairOrder[]): string {
  const max = existing.reduce((highest, repair) => {
    const match = repair.ref?.match(/REP\/?-?(\d+)$/i)
    const value = match ? Number(match[1]) : 0
    return Number.isFinite(value) ? Math.max(highest, value) : highest
  }, 0)
  return `REP/${String(max + 1).padStart(4, '0')}`
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const customerName = clean(body.customerName)
  const customerPhone = clean(body.customerPhone)
  const productName = clean(body.productName)
  const issueDescription = clean(body.issueDescription)
  const repairPath = clean(body.repairPath) === 'direct_repair' ? 'direct_repair' : 'diagnosis_first'
  const liabilityWaiverAccepted = body.liabilityWaiverAccepted === true

  if (!customerName) return NextResponse.json({ error: 'Customer name is required.' }, { status: 422 })
  if (!customerPhone) return NextResponse.json({ error: 'Customer phone is required.' }, { status: 422 })
  if (!productName) return NextResponse.json({ error: 'Device/product name is required.' }, { status: 422 })
  if (!issueDescription) return NextResponse.json({ error: 'Issue description is required.' }, { status: 422 })
  if (repairPath === 'direct_repair' && !liabilityWaiverAccepted) {
    return NextResponse.json({ error: 'Direct repairs require liability waiver acceptance.' }, { status: 422 })
  }

  const state = await loadAppState()
  const repairs = Array.isArray(state[REPAIR_STORE_KEY]) ? state[REPAIR_STORE_KEY] as RepairOrder[] : []
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const ref = nextRepairRef(repairs)

  const accessories = Array.isArray(body.accessories)
    ? body.accessories.map((item) => ({
        name: clean((item as Record<string, unknown>)?.name ?? item),
        received: true,
        notes: clean((item as Record<string, unknown>)?.notes),
      })).filter(item => item.name)
    : clean(body.accessories).split(',').map(name => name.trim()).filter(Boolean).map(name => ({ name, received: true }))

  const repair: RepairOrder = {
    id: `rep_${Date.now()}`,
    ref,
    status: 'pending_verification',
    customerId: '',
    customerName,
    customerPhone,
    customerEmail: clean(body.customerEmail) || undefined,
    productId: '',
    productName,
    serialNumber: clean(body.serialNumber),
    deviceCondition: ['good', 'fair', 'poor', 'damaged'].includes(clean(body.deviceCondition)) ? clean(body.deviceCondition) as RepairOrder['deviceCondition'] : undefined,
    priority: ['low', 'normal', 'high', 'urgent'].includes(clean(body.priority)) ? clean(body.priority) as RepairOrder['priority'] : 'normal',
    intakeChannel: 'website',
    intakeDate: today,
    intakeNotes: clean(body.intakeNotes),
    issueDescription,
    accessories,
    repairPath,
    liabilityWaiverAccepted,
    liabilityWaiverText: repairPath === 'direct_repair' ? WAIVER_TEXT : undefined,
    liabilityWaiverAcceptedAt: liabilityWaiverAccepted ? now : undefined,
    liabilityWaiverSignature: liabilityWaiverAccepted ? customerName : undefined,
    underWarranty: body.underWarranty === true,
    partsUsed: [],
    laborCost: 0,
    logisticsCost: 0,
    total: 0,
    qcItems: [],
    createdBy: 'portal_customer',
    bookedByName: 'Customer Portal',
    createdDate: today,
    notes: clean(body.notes),
    slaMissed: false,
    date: today,
    description: issueDescription,
    technicianName: '',
    intakeSource: 'customer',
  }

  const updatedRepairs = [repair, ...repairs]
  await saveStoreKeys({ [REPAIR_STORE_KEY]: JSON.stringify(updatedRepairs) })

  return NextResponse.json({ repair, trackingUrl: `/portal/repair/${encodeURIComponent(ref)}` }, { status: 201 })
}
