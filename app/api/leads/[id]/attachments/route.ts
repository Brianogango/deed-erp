import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { readLeadAttachmentFile, type LeadAttachmentMeta } from '@/lib/crm/lead-attachments'

/**
 * GET /api/leads/[id]/attachments
 * List or download inbound email attachments for a lead.
 * ?file=<attachmentId> downloads the binary.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const lead = await prisma.lead.findUnique({
      where: { id: params.id },
      select: { id: true, emailAttachments: true },
    })
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const attachments = Array.isArray(lead.emailAttachments)
      ? (lead.emailAttachments as LeadAttachmentMeta[])
      : []

    const fileId = new URL(req.url).searchParams.get('file')
    if (!fileId) {
      return NextResponse.json({ attachments })
    }

    const meta = attachments.find(a => a.id === fileId)
    if (!meta) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

    const buffer = await readLeadAttachmentFile(lead.id, meta)
    if (!buffer) return NextResponse.json({ error: 'Attachment file is missing' }, { status: 404 })

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': meta.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${meta.name.replace(/"/g, '')}"`,
      },
    })
  })
}
