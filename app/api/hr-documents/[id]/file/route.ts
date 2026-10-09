import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { isUserAllowed } from '@/lib/auth/authorization'
import { readBlob, writeBlob } from '@/lib/blob-store'
import { validateFileContent, logRejectedUpload } from '@/lib/file-validation'
import { loadAppState } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

// Contracts, IDs and permits: HR writes. Visibility is read from the document record.
const HR_ROLES = ['director', 'admin_officer']
const MAX_BYTES = 4 * 1024 * 1024
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const UUIDISH = /^[A-Za-z0-9_-]{8,64}$/

const blobKey = (id: string) => `hr_document_${id}`

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
  if (!match) return null
  return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    if (!UUIDISH.test(id)) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })

    let allowed = isUserAllowed(user, HR_ROLES)
    if (!allowed) {
      // Other roles see a file only when the document record says so; unknown records stay HR-only.
      const state = await loadAppState(['deed_hrDocuments'])
      const docs = Array.isArray(state.deed_hrDocuments) ? (state.deed_hrDocuments as Array<{ id?: string; employeeId?: string; visibility?: string }>) : []
      const doc = docs.find(d => d?.id === id)
      if (doc?.visibility === 'hr_finance') allowed = isUserAllowed(user, ['finance_officer'])
      else if (doc?.visibility === 'employee_visible') {
        allowed = isUserAllowed(user, ['finance_officer']) || (!!user.employeeId && user.employeeId === doc.employeeId)
      }
    }
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const stored = await readBlob(blobKey(id))
    if (!stored) return NextResponse.json({ error: 'No file attached to this document' }, { status: 404 })
    const parsed = parseDataUrl(stored)
    if (!parsed) return NextResponse.json({ error: 'Unsupported file format' }, { status: 415 })
    return new NextResponse(new Uint8Array(parsed.buffer), {
      status: 200,
      headers: {
        'Content-Type': parsed.contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(HR_ROLES)
    if (!UUIDISH.test(id)) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })
    const body = await request.json().catch(() => null) as { dataUrl?: string; fileName?: string } | null
    const parsed = body?.dataUrl ? parseDataUrl(body.dataUrl) : null
    if (!parsed) return NextResponse.json({ error: 'A file is required' }, { status: 400 })
    if (parsed.buffer.length === 0 || parsed.buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: 'File must be between 1 byte and 4 MB' }, { status: 413 })
    }
    if (!ALLOWED.includes(parsed.contentType)) {
      return NextResponse.json({ error: 'Upload a PDF, JPEG, PNG or WebP file' }, { status: 415 })
    }
    const check = validateFileContent(parsed.buffer, parsed.contentType)
    if (!check.ok) {
      logRejectedUpload({ route: '/api/hr-documents/[id]/file', declaredType: parsed.contentType, fileName: body?.fileName, size: parsed.buffer.length, reason: check.error, userId: actor.id })
      return NextResponse.json({ error: check.error }, { status: 415 })
    }
    await writeBlob(blobKey(id), body!.dataUrl!)
    return NextResponse.json({ ok: true, size: parsed.buffer.length, contentType: parsed.contentType })
  })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireRole(HR_ROLES)
    if (!UUIDISH.test(id)) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })
    await writeBlob(blobKey(id), '')
    return NextResponse.json({ ok: true })
  })
}
