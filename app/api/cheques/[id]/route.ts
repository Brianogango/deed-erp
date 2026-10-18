/**
 * PATCH — move a cheque through its life (deposit/present, clear, bounce,
 * cancel, reopen) or correct its details. Every status change is recorded in
 * the cheque's history with who and when.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireCan, withApiErrorHandling } from '@/lib/auth/api'
import { CHEQUE_STATUSES, canMoveTo, validateChequeInput, type ChequeStatus } from '@/lib/cheques/cheque-rules'
import { toChequeDto, type ChequeHistoryEntry } from '@/lib/cheques/cheque-store.server'

export const dynamic = 'force-dynamic'

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const user = await requireCan('accounting.cheques.manage')
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const existing = await prisma.cheque.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Cheque not found' }, { status: 404 })

    const data: Record<string, unknown> = {}
    const history = (Array.isArray(existing.history) ? existing.history : []) as ChequeHistoryEntry[]

    if (body.status !== undefined) {
      const to = String(body.status) as ChequeStatus
      if (!(CHEQUE_STATUSES as string[]).includes(to)) return NextResponse.json({ error: 'Unknown cheque status' }, { status: 422 })
      if (!canMoveTo(existing.status as ChequeStatus, to)) {
        return NextResponse.json({ error: `A ${existing.status} cheque cannot be marked ${to}` }, { status: 409 })
      }
      const note = text(body.note, 300)
      if ((to === 'bounced' || to === 'cancelled') && !note) {
        return NextResponse.json({ error: to === 'bounced' ? 'Say why the cheque bounced' : 'Say why the cheque is cancelled' }, { status: 422 })
      }
      data.status = to
      data.history = [...history, { at: new Date().toISOString(), by: user.name || user.username || user.id, status: to, ...(note ? { note } : {}) }]
    }

    const editable = ['chequeNumber', 'bankName', 'partyName', 'amount', 'chequeDate', 'linkedType', 'linkedRef', 'notes'].some(k => body[k] !== undefined)
    if (editable) {
      if (existing.status === 'cleared') return NextResponse.json({ error: 'A cleared cheque can no longer be edited' }, { status: 409 })
      const merged = {
        direction: existing.direction as 'received' | 'given',
        chequeNumber: body.chequeNumber !== undefined ? text(body.chequeNumber, 40) : existing.chequeNumber,
        partyName: body.partyName !== undefined ? text(body.partyName, 200) : existing.partyName,
        amount: body.amount !== undefined ? Number(body.amount) : Number(existing.amount),
        chequeDate: body.chequeDate !== undefined ? text(body.chequeDate, 10) : existing.chequeDate.toISOString().slice(0, 10),
      }
      const problem = validateChequeInput(merged)
      if (problem) return NextResponse.json({ error: problem }, { status: 422 })
      data.chequeNumber = merged.chequeNumber
      data.partyName = merged.partyName
      data.amount = merged.amount
      data.chequeDate = new Date(`${merged.chequeDate}T00:00:00Z`)
      if (body.bankName !== undefined) data.bankName = text(body.bankName, 120)
      if (body.linkedType !== undefined) data.linkedType = text(body.linkedType, 30) || null
      if (body.linkedRef !== undefined) data.linkedRef = text(body.linkedRef, 80) || null
      if (body.notes !== undefined) data.notes = text(body.notes, 1000) || null
    }

    if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    const row = await prisma.cheque.update({ where: { id }, data })
    return NextResponse.json({ cheque: toChequeDto(row) })
  })
}
