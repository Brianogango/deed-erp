import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import {
  nextRecurringRef, validateTemplate, type Frequency, type RecurringBill, type RecurringLine,
} from '@/lib/recurring/recurring-bills'

export const dynamic = 'force-dynamic'

const RECURRING_KEY = 'deed_recurringBills'
const ROLES = ['director', 'finance_officer']

async function read(): Promise<RecurringBill[]> {
  const state = await loadAppState([RECURRING_KEY])
  return Array.isArray(state[RECURRING_KEY]) ? (state[RECURRING_KEY] as RecurringBill[]) : []
}

function cleanLines(raw: unknown): RecurringLine[] {
  return (Array.isArray(raw) ? raw : []).map((l: Record<string, unknown>) => ({
    description: String(l?.description ?? '').trim().slice(0, 200),
    accountCode: String(l?.accountCode ?? '').trim().slice(0, 20) || undefined,
    amount: l?.amount === null || l?.amount === undefined || l?.amount === '' ? null : Number(l.amount),
  }))
}

/** GET /api/recurring-bills — all templates. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    return NextResponse.json({ items: await read() })
  })
}

/** POST /api/recurring-bills — create a template. Posts nothing. */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))
    const items = await read()

    const draft: Partial<RecurringBill> = {
      vendorId: String(body.vendorId ?? '').trim(),
      title: String(body.title ?? '').trim().slice(0, 120),
      frequency: String(body.frequency) as Frequency,
      dayOfMonth: Number(body.dayOfMonth),
      startDate: String(body.startDate ?? '').trim(),
      endDate: body.endDate ? String(body.endDate).trim() : undefined,
      vatRate: Number(body.vatRate ?? 0),
      lines: cleanLines(body.lines),
    }
    const problem = validateTemplate(draft)
    if (problem) return NextResponse.json({ error: problem }, { status: 422 })

    const item: RecurringBill = {
      id: crypto.randomUUID(),
      ref: nextRecurringRef(items),
      vendorId: draft.vendorId!,
      vendorName: String(body.vendorName ?? '').trim().slice(0, 160),
      title: draft.title!,
      frequency: draft.frequency!,
      dayOfMonth: draft.dayOfMonth!,
      startDate: draft.startDate!,
      endDate: draft.endDate,
      vatRate: draft.vatRate ?? 0,
      lines: draft.lines!,
      paused: false,
      notes: body.notes ? String(body.notes).slice(0, 500) : undefined,
      generated: [],
      createdAt: new Date().toISOString(),
      createdBy: actor.id,
    }
    await saveStoreKeys({ [RECURRING_KEY]: JSON.stringify([item, ...items]) })
    return NextResponse.json({ item }, { status: 201 })
  })
}
