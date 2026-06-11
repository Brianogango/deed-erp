import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

// Each SOP file is stored under its own app_state key:
//   sop_file_<sopId>
// This keeps file blobs out of deed_sop_documents so the list stays fast.

const MAX_FILE_BYTES = 5 * 1024 * 1024   // 5 MB hard limit
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]

function sopFileKey(sopId: string) {
  return `sop_file_${sopId}`
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
  if (!match) return null
  try {
    return { contentType: match[1] || 'application/octet-stream', buffer: Buffer.from(match[2], 'base64') }
  } catch {
    return null
  }
}

/**
 * GET /api/sop-files/[sopId]
 * Serves the SOP file directly as binary so the browser can display or download it.
 * Any authenticated user may fetch SOP files.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { sopId: string } }
) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const state = await loadAppState([sopFileKey(params.sopId)])
    const stored = state[sopFileKey(params.sopId)] as { dataUrl: string; fileName: string } | string | undefined

    if (!stored) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Support both legacy plain dataUrl and new { dataUrl, fileName } format
    const dataUrl = typeof stored === 'string' ? stored : stored.dataUrl
    const fileName = typeof stored === 'object' && stored.fileName ? stored.fileName : 'sop-document'

    const parsed = parseDataUrl(dataUrl)
    if (!parsed) {
      return NextResponse.json({ error: 'Unsupported file format' }, { status: 415 })
    }

    const disposition = req.nextUrl.searchParams.get('download') === '1'
      ? `attachment; filename="${encodeURIComponent(fileName)}"`
      : `inline; filename="${encodeURIComponent(fileName)}"`

    const body = parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': parsed.contentType,
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(parsed.buffer.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load file' }, { status: 500 })
  }
}

/**
 * POST /api/sop-files/[sopId]
 * Body: { dataUrl: string; fileName: string; fileSize: number }
 *
 * Size guards:
 *  - Rejects files > 5 MB (checked both on client and here server-side)
 *  - Rejects disallowed MIME types
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { sopId: string } }
) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only directors, admin officers, and technical leads can upload SOP files
  const role = (session.user as any).role ?? ''
  if (!['director', 'admin_officer', 'technical_lead'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { dataUrl?: string; fileName?: string; fileSize?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.dataUrl || !body.fileName) {
    return NextResponse.json({ error: 'dataUrl and fileName are required' }, { status: 400 })
  }

  // ── Server-side size guard ─────────────────────────────────────────────────
  const parsed = parseDataUrl(body.dataUrl)
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid file format — must be a base64 data URL' }, { status: 400 })
  }

  if (parsed.buffer.length > MAX_FILE_BYTES) {
    return NextResponse.json({
      error: `File too large. Maximum allowed size is 5 MB. Your file is ${(parsed.buffer.length / 1024 / 1024).toFixed(1)} MB.`,
    }, { status: 413 })
  }

  if (!ALLOWED_TYPES.includes(parsed.contentType)) {
    return NextResponse.json({
      error: `File type "${parsed.contentType}" is not allowed. Accepted types: PDF, Word (.doc/.docx), JPEG, PNG.`,
    }, { status: 415 })
  }

  try {
    await saveStoreKeys({
      [sopFileKey(params.sopId)]: JSON.stringify({ dataUrl: body.dataUrl, fileName: body.fileName }),
    })
    return NextResponse.json({ ok: true, fileSize: parsed.buffer.length })
  } catch {
    return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
  }
}

/**
 * DELETE /api/sop-files/[sopId]
 * Removes the file attachment for an SOP.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { sopId: string } }
) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = (session.user as any).role ?? ''
  if (!['director', 'admin_officer', 'technical_lead'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await saveStoreKeys({ [sopFileKey(params.sopId)]: '' })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
}
