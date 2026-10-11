import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling } from '@/lib/auth/api'
import { requireCreditUser } from '@/lib/credit/credit-facility-auth.server'
import { addDocument, readDocument, toScreen } from '@/lib/credit/credit-facility.server'

type Params = { params: Promise<{ id: string }> }

/** GET ?file=<docId> downloads a document. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireCreditUser()
    const docId = new URL(req.url).searchParams.get('file')
    if (!docId) return NextResponse.json({ error: 'Which file?' }, { status: 400 })
    const { doc, bytes } = await readDocument(id, docId)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': doc.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${doc.name.replace(/["\r\n]/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  })
}

/** POST multipart { file, kind } */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireCreditUser()
    const form = await req.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') ?? '')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file' }, { status: 400 })
    const bytes = Buffer.from(await file.arrayBuffer())
    const app = await addDocument(actor, id, { name: file.name || 'document', type: file.type, bytes }, kind)
    return NextResponse.json({ application: await toScreen(app, { withChecks: true }) }, { status: 201 })
  })
}
