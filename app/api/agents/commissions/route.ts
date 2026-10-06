/**
 * Manual agent commission bills (lib/agents/agent-commissions.ts).
 *
 * POST   — raise a commission bill for an agent (JSON, or multipart with an
 *          optional `file`: the agent's invoice, a receipt…). Due at once
 *          (Dr 6403 Agent Commissions / Cr 3314 Payable), paid with the
 *          agent's next payout.
 * GET    — ?file=AGB/0001 downloads the bill's attachment.
 * DELETE — ?id=AGB/0001 cancels an unpaid manual bill (journal reversed).
 */
import { randomUUID } from 'crypto'
import path from 'path'
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { addManualCommission, cancelManualCommission, findCommission } from '@/lib/agents/agent-commissions.server'
import { validateFileContent, logRejectedUpload } from '@/lib/file-validation'
import { deleteObject, getObject, putObject } from '@/lib/infra/object-store'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const safeStem = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'attachment'

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const id = new URL(request.url).searchParams.get('file')?.trim()
    const row = id ? await findCommission(id) : undefined
    if (!row?.attachment) return NextResponse.json({ error: 'No attachment on this commission' }, { status: 404 })
    const bytes = await getObject('uploads', row.attachment.objectKey)
    if (!bytes) return NextResponse.json({ error: 'Attachment file is missing' }, { status: 404 })
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.attachment.contentType,
        'Content-Disposition': `inline; filename="${row.attachment.name}"`,
      },
    })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const multipart = (request.headers.get('content-type') || '').includes('multipart/form-data')
    let body: Record<string, unknown> = {}
    let file: File | null = null
    if (multipart) {
      const form = await request.formData().catch(() => null)
      if (!form) return NextResponse.json({ error: 'Invalid upload form' }, { status: 400 })
      for (const [k, v] of form.entries()) if (typeof v === 'string') body[k] = v
      const f = form.get('file')
      if (f instanceof File && f.size > 0) file = f
    } else {
      body = await request.json().catch(() => ({})) as Record<string, unknown>
    }

    // The attachment is optional; when given it is checked and stored first,
    // so a bad file never leaves a bill behind without it.
    let attachment: { name: string; size: number; contentType: string; objectKey: string; uploadedAt: string } | undefined
    if (file) {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Attachments must be 10 MB or smaller' }, { status: 413 })
      const contentType = (file.type || 'application/octet-stream').toLowerCase()
      if (!ALLOWED_TYPES.has(contentType)) {
        return NextResponse.json({ error: 'Attach a PDF, Word, Excel, JPG, PNG or WebP file' }, { status: 415 })
      }
      const name = safeStem(file.name || 'attachment')
      const buffer = Buffer.from(await file.arrayBuffer())
      const check = validateFileContent(buffer, contentType)
      if (!check.ok) {
        logRejectedUpload({ route: 'agent-commissions', declaredType: contentType, fileName: name, size: file.size, reason: check.error, userId: actor.id })
        return NextResponse.json({ error: check.error }, { status: 415 })
      }
      const objectKey = `agent-commissions/${randomUUID()}${path.extname(name)}`
      await putObject({ bucket: 'uploads', key: objectKey, body: buffer, contentType })
      attachment = { name, size: file.size, contentType, objectKey, uploadedAt: new Date().toISOString() }
    }

    const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
    try {
      const commission = await addManualCommission({
        agentId: text(body.agentId, 64),
        amount: Number(body.amount),
        date: text(body.date, 10),
        saleRef: text(body.saleRef, 60) || undefined,
        customerName: text(body.customerName, 160) || undefined,
        saleTotal: Number(body.saleTotal) || 0,
        description: text(body.description, 300) || undefined,
        attachment,
        createdBy: { id: actor.id, name: actor.name || actor.username },
      })
      return NextResponse.json({ commission }, { status: 201 })
    } catch (err) {
      if (attachment) await deleteObject('uploads', attachment.objectKey).catch(() => {})
      throw err
    }
  })
}

export async function DELETE(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const id = new URL(request.url).searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ error: 'Which commission bill?' }, { status: 422 })
    const commission = await cancelManualCommission(id, { id: actor.id, name: actor.name || actor.username })
    return NextResponse.json({ commission })
  })
}
