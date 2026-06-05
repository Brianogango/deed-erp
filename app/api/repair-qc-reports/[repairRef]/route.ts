import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

type QcReportMeta = {
  id: string
  name: string
  size: number
  contentType: string
  uploadedAt: string
  url: string
  storagePath: string
}

const MAX_QC_REPORT_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function stateKey(ref: string) {
  return `repair_qc_reports_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
}

function safeStem(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'qc-report'
}

function publicUrl(ref: string, id: string) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/qc-report/${encodeURIComponent(id)}`
}

export async function POST(req: NextRequest, { params }: { params: { repairRef: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ref = decodeURIComponent(params.repairRef)
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'Invalid upload form' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'QC report file is required' }, { status: 400 })
  if (file.size <= 0) return NextResponse.json({ error: 'QC report file is empty' }, { status: 400 })
  if (file.size > MAX_QC_REPORT_BYTES) return NextResponse.json({ error: 'QC report must be 10 MB or smaller' }, { status: 413 })

  const contentType = file.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported QC report type. Upload PDF, Word, Excel, CSV, JPG, PNG, or WebP.' }, { status: 415 })
  }

  try {
    const id = randomUUID()
    const originalName = safeStem(file.name || 'qc-report')
    const ext = path.extname(originalName)
    const storageRoot = path.join(process.cwd(), '.uploads', 'qc-reports')
    const refDir = safeStem(ref.toUpperCase().replace(/\//g, '_'))
    const dir = path.join(storageRoot, refDir)
    await mkdir(dir, { recursive: true })
    const storagePath = path.join(dir, `${id}${ext || ''}`)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(storagePath, buffer)

    const key = stateKey(ref)
    const state = await loadAppState([key])
    const existing = Array.isArray(state[key]) ? state[key] as QcReportMeta[] : []
    const uploadedAt = new Date().toISOString()
    const meta: QcReportMeta = { id, name: originalName, size: file.size, contentType, uploadedAt, url: publicUrl(ref, id), storagePath }
    await saveStoreKeys({ [key]: JSON.stringify([...existing, meta]) })

    const { storagePath: _hidden, ...publicMeta } = meta
    return NextResponse.json({ report: publicMeta }, { status: 201 })
  } catch (err) {
    console.error('[repair-qc-reports] upload failed:', err)
    return NextResponse.json({ error: 'QC report upload failed' }, { status: 500 })
  }
}
