import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { registerPortalRepair, type PortalRepair } from '@/lib/portal-repairs'
import type { RepairOrder } from '@/lib/repair-types'

const VERIFY_ROLES  = ['release_authoriser', 'director', 'admin_officer']
const VOID_AFTER_VERIFIED_ROLES = ['director']

type Params = { params: { id: string } }

function repairToPortalRepair(repair: any, note?: string): PortalRepair {
  const status = repair.status as PortalRepair['status']
  const date = repair.collectedDate ?? repair.closedDate ?? new Date().toISOString()
  return {
    ref: repair.ref,
    status,
    customerName: repair.customerName,
    customerPhone: repair.customerPhone ?? '',
    customerEmail: repair.customerEmail,
    productName: repair.productName,
    serialNumber: repair.serialNumber ?? '',
    deviceCondition: repair.deviceCondition,
    intakeChannel: repair.intakeChannel ?? 'walk_in',
    intakeDate: repair.intakeDate ?? repair.date ?? date,
    estimatedCompletionDate: repair.estimatedCompletionDate,
    issueDescription: repair.issueDescription ?? repair.description ?? '',
    accessories: repair.accessories ?? [],
    assignedTechnicianName: repair.assignedTechnicianName ?? repair.technicianName,
    diagnosis: repair.diagnosis,
    diagnosisHistory: repair.diagnosisHistory,
    quote: repair.quote,
    statusHistory: [
      ...(Array.isArray(repair.statusHistory) ? repair.statusHistory : []),
      { status, date, note },
    ],
    repairStartDate: repair.repairStartDate,
    closedDate: repair.closedDate,
    slaMissed: repair.slaMissed ?? false,
    underWarranty: repair.underWarranty ?? false,
    notes: repair.notes,
    preRepairPhotos: repair.preRepairPhotos,
    issuePhotos: repair.issuePhotos,
    qcReportData: repair.qcReportData,
    qcReportName: repair.qcReportName,
    qcReportUrl: repair.qcReportUrl,
    qcReportId: repair.qcReportId,
    qcReportSize: repair.qcReportSize,
    qcReportType: repair.qcReportType,
    qcReportUploadedAt: repair.qcReportUploadedAt,
    diagnosisReportData: repair.diagnosisReportData,
    diagnosisReportName: repair.diagnosisReportName,
    invoiceId: repair.invoiceId ?? repair.linkedInvoiceId,
    invoiceRef: repair.linkedInvoiceRef,
    paymentStatus: repair.paymentConfirmationStatus,
    paymentAmount: repair.paymentConfirmationAmount,
    paymentReceiptNumber: repair.paymentReceiptNumber,
    paymentConfirmationSubmittedAt: repair.paymentConfirmationSubmittedAt,
  }
}

async function finalizeAppStateRepairForRelease(releaseId: string, repairId: string | null, body: any) {
  const state = await loadAppState(['deed_repairs_v2', 'deed_outboundReleases'])
  const repairs = Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as RepairOrder[] : []
  const releases = Array.isArray(state.deed_outboundReleases) ? state.deed_outboundReleases as any[] : []
  const appStateRelease = releases.find(release => release.id === releaseId)
  const targetRepairId = repairId ?? appStateRelease?.repairId
  if (!targetRepairId) return null

  let updatedRepair: any | null = null
  const updatedRepairs = repairs.map((repair: any) => {
    if (repair.id !== targetRepairId) return repair
    const collectedDate = new Date().toISOString()
    updatedRepair = {
      ...repair,
      status: 'collected',
      collectedDate,
      closedDate: collectedDate,
      conditionOnRelease: body.conditionOnRelease ?? repair.conditionOnRelease,
      deliveryRecipient: body.receivedBy ?? repair.deliveryRecipient,
      deliveryRecipientPhone: body.receivedByPhone ?? repair.deliveryRecipientPhone,
      notes: body.releaseNotes ? `${repair.notes ? `${repair.notes}\n` : ''}ORC release: ${body.releaseNotes}` : repair.notes,
    }
    return updatedRepair
  })

  if (!updatedRepair) return null
  await saveStoreKeys({ deed_repairs_v2: JSON.stringify(updatedRepairs) })
  registerPortalRepair(repairToPortalRepair(updatedRepair, `Device released to ${body.receivedBy}`))
  return updatedRepair
}

// ── GET single release ────────────────────────────────────────────────────────
export async function GET(_: NextRequest, { params }: Params) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const release = await prisma.outboundRelease.findUnique({
      where: { id: params.id },
      include: {
        initiatedBy: { select: { id: true, username: true } },
        verifiedBy:  { select: { id: true, username: true } },
        items:       true,
        auditLog:    { orderBy: { performedAt: 'asc' }, include: { performedBy: { select: { id: true, username: true } } } },
      },
    })
    if (!release) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(release)
  })
}

// ── PATCH — generic field update (e.g. item confirmedSerial) ─────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const body = await request.json()
    const release = await prisma.outboundRelease.update({
      where: { id: params.id },
      data: body,
    })
    return NextResponse.json(release)
  })
}

// ── POST /[id]/pick ───────────────────────────────────────────────────────────
export async function pickHandler(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const release = await prisma.outboundRelease.findUniqueOrThrow({ where: { id } })
    if (release.status !== 'pending') {
      return NextResponse.json({ error: `Cannot pick from status ${release.status}` }, { status: 400 })
    }
    const updated = await prisma.outboundRelease.update({
      where: { id },
      data: {
        status: 'all_picked',
        auditLog: { create: [{ action: 'all_picked', fromStatus: 'pending', toStatus: 'all_picked', performedById: session.user.id }] },
      },
      include: { items: true },
    })
    return NextResponse.json(updated)
  })
}

// ── POST /[id]/verify ─────────────────────────────────────────────────────────
export async function verifyHandler(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(VERIFY_ROLES)
    const body    = await request.json()

    // Load release with source document to check separation of duties
    const release = await prisma.outboundRelease.findUniqueOrThrow({
      where: { id },
      include: {
        invoice: { select: { createdById: true } },
        repair:  { select: { createdById: true, assignedToId: true } },
      },
    })

    if (release.status !== 'all_picked' && release.status !== 'pending') {
      return NextResponse.json({ error: `Cannot verify from status ${release.status}` }, { status: 400 })
    }

    // Separation of duties check
    const invoiceCreator = release.invoice?.createdById
    const repairCreator  = release.repair?.createdById
    const repairTech     = release.repair?.assignedToId
    if (
      actor.id === invoiceCreator ||
      actor.id === repairCreator  ||
      actor.id === repairTech
    ) {
      return NextResponse.json({ error: 'You cannot release your own sale or repair — a different authoriser must verify.' }, { status: 403 })
    }

    // Update item confirmed serials if provided
    if (body.items?.length) {
      for (const item of body.items as { id: string; confirmedSerial: string }[]) {
        await prisma.outboundReleaseItem.update({
          where: { id: item.id },
          data: {
            confirmedSerial: item.confirmedSerial,
            serialMatched: item.confirmedSerial?.trim().toLowerCase() === undefined ? null
              : undefined, // computed below
            status: 'verified',
            verifiedById: actor.id,
            verifiedAt: new Date(),
          },
        })
      }
      // Recompute serialMatched from DB
      const items = await prisma.outboundReleaseItem.findMany({ where: { releaseId: id } })
      for (const item of items) {
        if (item.confirmedSerial != null) {
          await prisma.outboundReleaseItem.update({
            where: { id: item.id },
            data: { serialMatched: item.confirmedSerial.trim().toLowerCase() === item.expectedSerial.trim().toLowerCase() },
          })
        }
      }
    }

    const updated = await prisma.outboundRelease.update({
      where: { id },
      data: {
        status:      'verified',
        verifiedById: actor.id,
        verifiedAt:  new Date(),
        auditLog: { create: [{ action: 'verified', fromStatus: release.status, toStatus: 'verified', performedById: actor.id }] },
      },
      include: { items: true },
    })

    // Advance repair to verified_released
    if (release.repairId) {
      await prisma.repair.update({ where: { id: release.repairId }, data: { status: 'verified_released' } })
    }

    return NextResponse.json(updated)
  })
}

// ── POST /[id]/release ────────────────────────────────────────────────────────
export async function releaseHandler(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(VERIFY_ROLES)
    const body    = await request.json()

    const release = await prisma.outboundRelease.findUniqueOrThrow({ where: { id } })
    if (release.status !== 'verified') {
      return NextResponse.json({ error: 'Release must be verified before marking released' }, { status: 400 })
    }
    if (!body.receivedBy?.trim()) {
      return NextResponse.json({ error: 'receivedBy is required' }, { status: 400 })
    }
    // Signature gate
    const hasSig = body.receiverSigData || (body.receiverSigMethod === 'paper' && body.receiverSigRef)
    if (!hasSig) {
      return NextResponse.json({ error: 'Receiver signature is required (digital data or paper reference)' }, { status: 400 })
    }

    const updated = await prisma.outboundRelease.update({
      where: { id },
      data: {
        status:      'released',
        releasedAt:  new Date(),
        receivedBy:       body.receivedBy,
        receivedByPhone:  body.receivedByPhone  ?? null,
        releaseNotes:     body.releaseNotes     ?? null,
        conditionOnRelease: body.conditionOnRelease ?? null,
        receiverSigData:   body.receiverSigData   ?? null,
        receiverSigMethod: body.receiverSigMethod  ?? null,
        receiverSigRef:    body.receiverSigRef     ?? null,
        releaserSigData:   body.releaserSigData    ?? null,
        releaserSigMethod: body.releaserSigMethod   ?? null,
        releaserSigRef:    body.releaserSigRef      ?? null,
        customerAckSigData:   body.customerAckSigData   ?? null,
        customerAckSigMethod: body.customerAckSigMethod  ?? null,
        customerAckSigRef:    body.customerAckSigRef     ?? null,
        items: { updateMany: { where: { releaseId: id }, data: { status: 'released' } } },
        auditLog: { create: [{ action: 'released', fromStatus: 'verified', toStatus: 'released', performedById: actor.id, notes: body.releaseNotes }] },
      },
      include: { items: true },
    })

    // Advance repair to collected
    if (release.repairId) {
      await prisma.repair.update({
        where: { id: release.repairId },
        data: { status: 'collected', collectedDate: new Date(), conditionOnRelease: body.conditionOnRelease ?? null },
      })
    }
    await finalizeAppStateRepairForRelease(id, release.repairId ?? null, body)

    return NextResponse.json(updated)
  })
}

// ── POST /[id]/void ───────────────────────────────────────────────────────────
export async function voidHandler(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body    = await request.json()
    const release = await prisma.outboundRelease.findUniqueOrThrow({ where: { id } })

    if (release.status === 'released' || release.status === 'voided') {
      return NextResponse.json({ error: `Cannot void a ${release.status} release` }, { status: 400 })
    }
    if (release.status === 'verified') {
      await requireRole(VOID_AFTER_VERIFIED_ROLES)
    }

    const updated = await prisma.outboundRelease.update({
      where: { id },
      data: {
        status:    'voided',
        voidedById: session.user.id,
        voidedAt:  new Date(),
        voidReason: body.reason ?? null,
        auditLog: { create: [{ action: 'voided', fromStatus: release.status, toStatus: 'voided', performedById: session.user.id, notes: body.reason }] },
      },
    })

    // Roll back repair to ready if it was advanced
    if (release.repairId && release.status === 'verified') {
      await prisma.repair.update({ where: { id: release.repairId }, data: { status: 'ready' } })
    }

    return NextResponse.json(updated)
  })
}
