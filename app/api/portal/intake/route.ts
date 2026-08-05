import { NextRequest, NextResponse } from 'next/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getNextRepairRef } from '@/lib/repair-ref-counter'
import { checkRateLimit } from '@/lib/rate-limit'
import type { RepairOrder } from '@/lib/store'
import { buildRepairLinkMessage, sendMultiChannelMessage } from '@/lib/integrations/messaging'
import { DIRECT_REPAIR_WAIVER_TEXT, normalizeRepairPath } from '@/lib/repair-path'
import { normalizeDeviceTier, resolveDiagnosisFee, resolveCustomerBillingType } from '@/lib/diagnosis-fee'

const REPAIR_STORE_KEY = 'deed_repairs_v2'

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

// Reference generation is now handled server-side by getNextRepairRef()
// to ensure uniqueness across concurrent requests

export async function POST(req: NextRequest) {
  // Rate limit: 5 submissions per IP per hour
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const rl = await checkRateLimit(`portal-intake:${ip}`, 5, 3600)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many submissions from this address. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

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
  const repairPath = normalizeRepairPath(body.repairPath)
  const liabilityWaiverAccepted = body.liabilityWaiverAccepted === true
  // Device tier is staff-picked (not customer portal). Portal leaves fee pending for Diagnosis First.
  const deviceTier = normalizeDeviceTier(body.deviceTier)

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
  // Get the next unique repair reference from the atomic server-side counter
  const ref = await getNextRepairRef()

  const accessories = Array.isArray(body.accessories)
    ? body.accessories.map((item) => ({
        name: clean((item as Record<string, unknown>)?.name ?? item),
        received: true,
        notes: clean((item as Record<string, unknown>)?.notes),
      })).filter(item => item.name)
    : clean(body.accessories).split(',').map(name => name.trim()).filter(Boolean).map(name => ({ name, received: true }))

  const settings = state['deed_systemSettings'] as { diagnosisFeeKes?: number } | undefined
  const feeResolved = resolveDiagnosisFee({
    repairPath,
    intakeDate: now,
    underWarranty: body.underWarranty === true,
  }, settings)
  const billingType = resolveCustomerBillingType(
    clean(body.clientType) === 'company' ? 'company' : 'individual',
  )

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
    intakeDate: now,
    intakeNotes: clean(body.intakeNotes),
    issueDescription,
    accessories,
    repairPath,
    deviceTier: repairPath === 'diagnosis_first' ? (deviceTier ?? undefined) : undefined,
    diagnosisFee: feeResolved.amount,
    diagnosisFeeStatus: feeResolved.status,
    diagnosisFeeBilling: feeResolved.status === 'applicable' ? 'invoice' : undefined,
    customerBillingType: billingType,
    liabilityWaiverAccepted,
    liabilityWaiverText: repairPath === 'direct_repair' ? DIRECT_REPAIR_WAIVER_TEXT : undefined,
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

  const relativeTrackingUrl = `/portal/repair/${encodeURIComponent(ref)}`
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke').replace(/\/$/, '')
  const trackingUrl = `${appBaseUrl}${relativeTrackingUrl}`
  const linkDelivery = repair.customerEmail
    ? await sendMultiChannelMessage({
        purpose: 'repair_link',
        recipient: { name: customerName, email: repair.customerEmail, phone: customerPhone },
        channels: ['email'],
        mailbox: 'sales',
        content: buildRepairLinkMessage({
          customerName,
          repairRef: ref,
          deviceName: productName,
          trackingUrl,
          message: 'Your repair request has been received. You can track progress using the secure link below.',
        }),
        metadata: { repairId: repair.id, repairRef: ref, action: 'portal_intake' },
      })
    : undefined

  return NextResponse.json({ repair, trackingUrl: relativeTrackingUrl, linkDelivery }, { status: 201 })
}
