import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { readFile } from 'fs/promises'
import { loadAppState } from '@/lib/server-store'
import type { RepairOrder } from '@/lib/repair-types'

type DiagnosisReportMeta = {
  id: string
  name: string
  size?: number
  contentType?: string
  uploadedAt?: string
  url?: string
  storagePath?: string
}

function stateKey(ref: string) {
  return `repair_diagnosis_reports_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
  if (!match) return null
  try { return { contentType: match[1] || 'application/octet-stream', buffer: Buffer.from(match[2], 'base64') } } catch { return null }
}

function safeFileName(name?: string) {
  return (name || 'diagnosis-report').replace(/[\r\n"]/g, '_')
}

async function loadReports(ref: string): Promise<DiagnosisReportMeta[]> {
  const decoded = decodeURIComponent(ref)
  const key = stateKey(decoded)
  const state = await loadAppState([key])
  const stored = state[key]
  return Array.isArray(stored) ? stored as DiagnosisReportMeta[] : []
}

/**
 * GET /api/portal/repair/[ref]/diagnosis-report/[id]
 * Serves a diagnosis report from disk; falls back to the legacy inline
 * base64 field on the repair record for reports uploaded before reports
 * were externalized.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string; id: string } }) {
  try {
    const reports = await loadReports(params.ref)
    const report = params.id === 'latest' ? reports[reports.length - 1] : reports.find(r => r.id === params.id)

    if (report?.storagePath) {
      const storageRoot = path.resolve(process.cwd(), '.uploads', 'diagnosis-reports')
      const filePath = path.resolve(report.storagePath)
      if (!filePath.startsWith(storageRoot + path.sep)) return NextResponse.json({ error: 'Invalid report path' }, { status: 400 })
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

    // Legacy fallback: base64 report embedded in the repair record
    const state = await loadAppState(['deed_repairs_v2', 'deed_repairs'])
    const decoded = decodeURIComponent(params.ref)
    const repairs = (Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] : state['deed_repairs']) as RepairOrder[] | undefined
    const repair = repairs?.find(r => r.ref?.toLowerCase() === decoded.toLowerCase())
    const parsed = repair?.diagnosisReportData ? parseDataUrl(repair.diagnosisReportData) : null
    if (!parsed) return NextResponse.json({ error: 'Diagnosis report not found' }, { status: 404 })
    const body = parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': parsed.contentType,
        'Content-Disposition': `attachment; filename="${safeFileName(repair?.diagnosisReportName)}"`,
        'Content-Length': String(parsed.buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[portal diagnosis report] download failed:', err)
    return NextResponse.json({ error: 'Failed to load diagnosis report' }, { status: 500 })
  }
}
