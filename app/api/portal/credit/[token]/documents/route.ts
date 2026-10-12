import { NextRequest, NextResponse } from 'next/server'
import { MAX_DOCUMENT_BYTES, portalAddDocument, toPortalView } from '@/lib/credit/credit-facility.server'
import { noStore, portalHandler } from '@/lib/credit/portal-guard.server'

export const dynamic = 'force-dynamic'

/** POST multipart { file, kind } — the client uploads a document. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return portalHandler(req, 'upload', 60, async () => {
    // Refuse oversized uploads before reading them into memory.
    const declared = Number(req.headers.get('content-length') || 0)
    if (declared > MAX_DOCUMENT_BYTES + 64 * 1024) return NextResponse.json({ error: 'Files must be 10 MB or smaller' }, { status: 413, headers: noStore })
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file' }, { status: 400 })
    const bytes = Buffer.from(await file.arrayBuffer())
    const app = await portalAddDocument(token, { name: file.name || 'document', type: file.type, bytes }, String(form.get('kind') ?? ''))
    return NextResponse.json({ application: await toPortalView(app) }, { status: 201, headers: noStore })
  }, token)
}
