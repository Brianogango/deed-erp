import { NextRequest, NextResponse } from 'next/server'
import { lookupRepair } from '@/lib/portal-repair-server'

function publicPhotoUrl(ref: string, index: number) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/photos/${index}`
}

function publicQcReportUrl(ref: string, id?: string) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/qc-report/${encodeURIComponent(id || 'latest')}`
}

function stripInlinePhotoPayloads(repair: any) {
  const next = { ...repair }
  if (Array.isArray(repair?.issuePhotos)) {
    next.issuePhotos = repair.issuePhotos.map((photo: any, index: number) => ({
      ...photo,
      url: typeof photo?.url === 'string' && photo.url.startsWith('data:image/')
        ? publicPhotoUrl(repair.ref, index)
        : photo?.url,
    }))
  }
  if (!next.qcReportUrl && typeof next.qcReportData === 'string' && next.qcReportData.startsWith('data:')) {
    next.qcReportUrl = publicQcReportUrl(next.ref, next.qcReportId)
  }
  return next
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ref = decodeURIComponent(params.ref)
  const repair = await lookupRepair(ref)

  if (!repair) {
    return NextResponse.json(
      { error: 'Repair not found. Please check your reference number and try again.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ repair: stripInlinePhotoPayloads(repair) }, { status: 200 })
}
