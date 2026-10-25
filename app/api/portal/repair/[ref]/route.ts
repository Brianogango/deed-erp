import { NextRequest, NextResponse } from 'next/server'
import { lookupRepair } from '@/lib/portal-repair-server'
import { maskPhone } from '@/lib/portal-verify'
import { guardPortalRoute } from '@/lib/portal/portal-guard.server'

function publicPhotoUrl(ref: string, index: number) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/photos/${index}`
}

function publicQcReportUrl(ref: string, id?: string) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/qc-report/${encodeURIComponent(id || 'latest')}`
}

function publicDiagnosisReportUrl(ref: string, id?: string) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/diagnosis-report/${encodeURIComponent(id || 'latest')}`
}

// Files never travel inline in this public status response: photos and
// reports are fetched from their own endpoints, which check the customer's
// phone number the way the invoice and receipt PDFs do.
function stripInlinePhotoPayloads(repair: any) {
  const next = { ...repair }
  if (Array.isArray(repair?.issuePhotos)) {
    next.issuePhotos = repair.issuePhotos.map((photo: any, index: number) => ({
      ...photo,
      url: typeof photo?.url === 'string' && photo.url.startsWith('data:')
        ? publicPhotoUrl(repair.ref, index)
        : photo?.url,
    }))
  }
  if (typeof next.qcReportData === 'string' && next.qcReportData) {
    if (!next.qcReportUrl || String(next.qcReportUrl).startsWith('data:')) next.qcReportUrl = publicQcReportUrl(next.ref, next.qcReportId)
    delete next.qcReportData
  }
  if (typeof next.diagnosisReportData === 'string' && next.diagnosisReportData) {
    if (!next.diagnosisReportUrl || String(next.diagnosisReportUrl).startsWith('data:')) next.diagnosisReportUrl = publicDiagnosisReportUrl(next.ref, next.diagnosisReportId)
    delete next.diagnosisReportData
  }
  // Mask the customer phone so it can serve as an ownership secret for
  // state-changing portal actions (quote approval, payment confirmation).
  if (next.customerPhone) next.customerPhone = maskPhone(next.customerPhone)
  // Email is equally identifying — mask it the same way.
  if (next.customerEmail) next.customerEmail = maskEmail(next.customerEmail)
  return next
}

/** Mask an email for display, e.g. "jane.doe@example.com" -> "ja**@example.com". */
function maskEmail(email: string | null | undefined): string {
  const raw = String(email ?? '')
  const at = raw.indexOf('@')
  if (at <= 0) return raw ? '**' : ''
  const head = raw.slice(0, Math.min(2, at))
  return `${head}${'*'.repeat(Math.max(2, at - head.length))}${raw.slice(at)}`
}

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> }
) {
  const resolvedParams = await params
  const ref = decodeURIComponent(resolvedParams.ref)
  const repair = await lookupRepair(ref)

  if (!repair) {
    return NextResponse.json(
      { error: 'Repair not found. Please check your reference number and try again.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ repair: stripInlinePhotoPayloads(repair) }, { status: 200 })
}

export const GET = guardPortalRoute('repair-view', 600, handleGET)
