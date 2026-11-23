/**
 * Cheque register (lib/cheques/cheque-rules.ts).
 *
 * GET  — every cheque, newest cheque date first, with today's alert state
 *        and, when it pays a document on its date, that schedule.
 * POST — add a cheque received or given, optionally with a photo of it, and
 *        optionally the invoice / bill it pays on its date (scheduleInvoiceId +
 *        bankAccountId; lib/cheques/cheque-schedule.server.ts). A cheque dated
 *        today or earlier is applied at once.
 */
import { applyMaturedCheques, listSchedules, scheduleCheque } from '@/lib/cheques/cheque-schedule.server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { putObject } from '@/lib/infra/object-store'
import { logRejectedUpload, validateFileContent } from '@/lib/file-validation'
import { validateChequeInput, type ChequeDirection } from '@/lib/cheques/cheque-rules'
import {
  CHEQUE_IMAGE_BUCKET,
  CHEQUE_IMAGE_MAX_BYTES,
  CHEQUE_IMAGE_TYPES,
  chequeImageKey,
  nairobiToday,
  toChequeDto,
} from '@/lib/cheques/cheque-store.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const dateOrNull = (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? new Date(`${value}T00:00:00Z`) : null)

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.cheques.view')
    // ?invoiceId=&ref= : the cheques for one invoice / bill (scheduled on it, or naming it).
    const url = new URL(request.url)
    const invoiceId = url.searchParams.get('invoiceId')?.trim() || ''
    const ref = url.searchParams.get('ref')?.trim() || ''
    const forDoc = invoiceId || ref
      ? {
          OR: [
            ...(invoiceId ? [{ id: { in: (await listSchedules({ invoiceId }).catch(() => [])).map(s => s.chequeId) } }] : []),
            ...(ref ? [{ linkedRef: { contains: ref, mode: 'insensitive' as const } }] : []),
          ],
        }
      : undefined
    const rows = await prisma.cheque.findMany({ where: forDoc, orderBy: [{ chequeDate: forDoc ? 'asc' : 'desc' }, { createdAt: 'desc' }], take: 2000 })
    const today = nairobiToday()
    const schedules = new Map((await listSchedules().catch(() => [])).map(s => [s.chequeId, s]))
    return NextResponse.json({
      today,
      cheques: rows.map(row => {
        const s = schedules.get(row.id)
        return { ...toChequeDto(row, today), ...(s ? { schedule: { invoiceId: s.invoiceId, state: s.state, message: s.message, appliedAt: s.appliedAt } } : {}) }
      }),
    })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('accounting.cheques.manage')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const direction = body.direction as ChequeDirection
    const chequeNumber = text(body.chequeNumber, 40)
    const bankName = text(body.bankName, 120)
    const input = {
      direction,
      chequeNumber,
      partyName: text(body.partyName, 200),
      amount: Number(body.amount),
      chequeDate: text(body.chequeDate, 10),
    }
    const problem = validateChequeInput(input)
    if (problem) return NextResponse.json({ error: problem }, { status: 422 })

    const duplicate = await prisma.cheque.findFirst({
      where: {
        direction,
        chequeNumber,
        bankName: { equals: bankName, mode: 'insensitive' },
        status: { not: 'cancelled' },
      },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: `Cheque ${chequeNumber} is already in the register` }, { status: 409 })
    }

    const id = randomUUID()
    let imageKey: string | null = null
    let imageType: string | null = null
    const imageBase64 = String(body.imageBase64 ?? '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '')
    if (imageBase64) {
      imageType = String(body.imageType ?? '').toLowerCase()
      if (!CHEQUE_IMAGE_TYPES.has(imageType)) return NextResponse.json({ error: 'The cheque photo must be a JPG, PNG or WebP image' }, { status: 415 })
      const buffer = Buffer.from(imageBase64, 'base64')
      if (buffer.length > CHEQUE_IMAGE_MAX_BYTES) return NextResponse.json({ error: 'The cheque photo is larger than 8 MB' }, { status: 413 })
      const check = validateFileContent(buffer, imageType)
      if (!check.ok) {
        logRejectedUpload({ route: 'cheques', declaredType: imageType, size: buffer.length, reason: check.error, userId: user.id })
        return NextResponse.json({ error: check.error }, { status: 415 })
      }
      imageKey = chequeImageKey(id, imageType)
      await putObject({ bucket: CHEQUE_IMAGE_BUCKET, key: imageKey, body: buffer, contentType: imageType })
    }

    const now = new Date().toISOString()
    const row = await prisma.cheque.create({
      data: {
        id,
        direction,
        chequeNumber,
        bankName,
        partyName: input.partyName,
        amount: input.amount,
        chequeDate: new Date(`${input.chequeDate}T00:00:00Z`),
        receivedDate: dateOrNull(body.receivedDate),
        linkedType: text(body.linkedType, 30) || null,
        linkedRef: text(body.linkedRef, 80) || null,
        notes: text(body.notes, 1000) || null,
        imageKey,
        imageType,
        createdBy: user.id,
        history: [{ at: now, by: user.name || user.username || user.id, status: 'pending', note: direction === 'received' ? 'Cheque received' : 'Cheque issued' }],
      },
    })
    // Pays an invoice / bill on its date: link it now; a cheque already due goes at once.
    const scheduleInvoiceId = text(body.scheduleInvoiceId, 64)
    if (scheduleInvoiceId) {
      try {
        await scheduleCheque({ chequeId: row.id, invoiceId: scheduleInvoiceId, bankAccountId: text(body.bankAccountId, 64) })
      } catch (err) {
        await prisma.cheque.delete({ where: { id: row.id } }).catch(() => {})
        const status = (err as { status?: number })?.status ?? 422
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not link the cheque to that document' }, { status })
      }
      if (input.chequeDate <= nairobiToday()) await applyMaturedCheques({ onlyChequeIds: [row.id] }).catch(() => [])
    }
    const fresh = await prisma.cheque.findUnique({ where: { id: row.id } })
    return NextResponse.json({ cheque: toChequeDto(fresh ?? row) }, { status: 201 })
  })
}
