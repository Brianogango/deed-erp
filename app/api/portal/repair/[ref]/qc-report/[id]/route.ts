import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { readFile } from 'fs/promises'
import { loadAppState } from '@/lib/server-store'
import type { RepairOrder } from '@/lib/repair-types'

type QcReportMeta = {
  id: string
  name: string
  size?: number
  contentType?: string
  uploadedAt?: string
  url?: string
  storagePath?: string
}

function stateKey(ref: string) {
  return `repair_qc_reports_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
  if (!match) return null
  try { return { contentType: match[1] || 'application/octet-stream', buffer: Buffer.from(match[2], 'base64') } } catch { return null }
}

function safeFileName(name?: string) {
  return (name || 'qc-report').replace(/[\r\n"]/g, '_')
}

async function loadReports(ref: string): Promise<QcReportMeta[]> {
  const decoded = decodeURIComponent(ref)
  const key = stateKey(decoded)
  const state = await loadAppState([key, 'deed_repairs_v2', 'deed_repairs'])
  const stored = state[key]
  if (Array.isArray(stored) && stored.length > 0) return stored as QcReportMeta[]

  const repairs = (Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] : state['deed_repairs']) as RepairOrder[] | undefined
  const repair = repairs?.find(r => r.ref?.toLowerCase() === decoded.toLowerCase())
  if (repair && (repair.qcReportData || (repair as any).qcReportUrl)) {
    return [{ id: (repair as any).qcReportId || 'latest', name: repair.qcReportName || 'qc-report', contentType: (repair as any).qcReportType, url: (repair as any).qcReportUrl }]
  }
  return []
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string; id: string } }) {
  try {
    const reports = await loadReports(params.ref)
    const report = params.id === 'latest' ? reports[reports.length - 1] : reports.find(r => r.id === params.id)
    if (!report) return NextResponse.json({ error: 'QC report not found' }, { status: 404 })

    if (report.storagePath) {
      const storageRoot = path.resolve(process.cwd(), '.uploads', 'qc-reports')
      const filePath = path.resolve(report.storagePath)
      if (!filePath.startsWith(storageRoot + path.sep)) return NextResponse.json({ error: 'Invalid QC report path' }, { status: 400 })
      const buffer = await readFile(filePath)
      const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      return new NextResponse(body as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': report.contentType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeFileName(report.name)}"`,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, max-age=3600',
        },
      })
    }

    if (report.url && /^https?:\/\//i.test(report.url)) return NextResponse.redirect(report.url, 302)

    const state = await loadAppState(['deed_repairs_v2', 'deed_repairs'])
    const decoded = decodeURIComponent(params.ref)
    const repairs = (Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] : state['deed_repairs']) as RepairOrder[] | undefined
    const repair = repairs?.find(r => r.ref?.toLowerCase() === decoded.toLowerCase())
    const parsed = repair?.qcReportData ? parseDataUrl(repair.qcReportData) : null
    if (!parsed) return NextResponse.json({ error: 'Unsupported QC report format' }, { status: 415 })
    const body = parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': parsed.contentType,
        'Content-Disposition': `attachment; filename="${safeFileName(repair?.qcReportName)}"`,
        'Content-Length': String(parsed.buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[portal qc report] download failed:', err)
    return NextResponse.json({ error: 'Failed to load QC report' }, { status: 500 })
  }
}
