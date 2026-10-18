/**
 * Cheque register (lib/cheques/cheque-rules.ts).
 *
 * GET  — every cheque, newest cheque date first, with today's alert state.
 * POST — add a cheque received or given, optionally with a photo of it.
 */
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { requireCan, withApiErrorHandling } from '@/lib/auth/api'
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

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireCan('accounting.cheques.view')
    const rows = await prisma.cheque.findMany({ orderBy: [{ chequeDate: 'desc' }, { createdAt: 'desc' }], take: 2000 })
    const today = nairobiToday()
    return NextResponse.json({ today, cheques: rows.map(row => toChequeDto(row, today)) })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const user = await requireCan('accounting.cheques.manage')
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
    return NextResponse.json({ cheque: toChequeDto(row) }, { status: 201 })
  })
}
