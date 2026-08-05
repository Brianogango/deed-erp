import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { validateFileContent, logRejectedUpload } from '@/lib/file-validation'

type DiagnosisReportMeta = {
  id: string
  name: string
  size: number
  contentType: string
  uploadedAt: string
  url: string
  storagePath: string
}

const MAX_REPORT_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function stateKey(ref: string) {
  return `repair_diagnosis_reports_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
}

function safeStem(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'diagnosis-report'
}

function publicUrl(ref: string, id: string) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/diagnosis-report/${encodeURIComponent(id)}`
}

/**
 * POST /api/repair-diagnosis-reports/[repairRef]
 * Stores a diagnosis report on disk (like QC reports) instead of embedding
 * the file as base64 inside the repair record, which bloats every page load
 * and store sync.
 */
export async function POST(req: NextRequest, { params }: { params: { repairRef: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ref = decodeURIComponent(params.repairRef)
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'Invalid upload form' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Diagnosis report file is required' }, { status: 400 })
  if (file.size <= 0) return NextResponse.json({ error: 'Diagnosis report file is empty' }, { status: 400 })
  if (file.size > MAX_REPORT_BYTES) return NextResponse.json({ error: 'Diagnosis report must be 10 MB or smaller' }, { status: 413 })

  const contentType = (file.type || 'application/octet-stream').toLowerCase()
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported report type. Upload PDF, Word, JPG, PNG, or WebP.' }, { status: 415 })
  }

  try {
    const id = randomUUID()
    const originalName = safeStem(file.name || 'diagnosis-report')
    const ext = path.extname(originalName)
    const storageRoot = path.join(process.cwd(), '.uploads', 'diagnosis-reports')
    const refDir = safeStem(ref.toUpperCase().replace(/\//g, '_'))
    const dir = path.join(storageRoot, refDir)
    await mkdir(dir, { recursive: true })
    const storagePath = path.join(dir, `${id}${ext || ''}`)
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentCheck = validateFileContent(buffer, contentType)
    if (!contentCheck.ok) {
      logRejectedUpload({
        route: 'repair-diagnosis-reports',
        declaredType: contentType,
        fileName: originalName,
        size: file.size,
        reason: contentCheck.error,
        userId: session.user.id,
      })
      return NextResponse.json({ error: contentCheck.error }, { status: 415 })
    }
    await writeFile(storagePath, buffer)

    const key = stateKey(ref)
    const state = await loadAppState([key])
    const existing = Array.isArray(state[key]) ? state[key] as DiagnosisReportMeta[] : []
    const uploadedAt = new Date().toISOString()
    const meta: DiagnosisReportMeta = { id, name: originalName, size: file.size, contentType, uploadedAt, url: publicUrl(ref, id), storagePath }
    await saveStoreKeys({ [key]: JSON.stringify([...existing, meta]) })

    const { storagePath: _hidden, ...publicMeta } = meta
    return NextResponse.json({ report: publicMeta }, { status: 201 })
  } catch (err) {
    console.error('[repair-diagnosis-reports] upload failed:', err)
    return NextResponse.json({ error: 'Diagnosis report upload failed' }, { status: 500 })
  }
}
