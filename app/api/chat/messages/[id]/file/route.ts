import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { attachmentFor } from '@/lib/chat/chat.server'
import { getObject } from '@/lib/infra/object-store'

export const dynamic = 'force-dynamic'

/** GET — the photo or file sent with a message, for members of its conversation. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await params
    const att = await attachmentFor(session.user.id, id)
    const bytes = await getObject('uploads', att.key)
    if (!bytes) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    const inline = att.contentType.startsWith('image/') && new URL(request.url).searchParams.get('download') !== '1'
    const name = encodeURIComponent(att.name)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': att.contentType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  })
}
