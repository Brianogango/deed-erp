import 'server-only'

import prisma from '@/lib/prisma'
import { sql } from '@/lib/auth/db'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { cashLabelForBankAccount } from '@/lib/accounting/bank-cash-account.server'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { isPayableInvoiceStatus } from '@/lib/accounting/payment-allocations'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { loadAppState, saveStoreKeys, notifyStoreKeysChanged } from '@/lib/server-store'
import { nairobiToday } from './cheque-store.server'
import { chequeClearsOn, clearingDaysSetting } from './clearing'

/**
 * Post-dated cheques that settle an invoice or a bill on their own date.
 *
 * A cheque in the register may be linked here to the document it pays and the
 * bank account it goes through. Until its date nothing is posted; the
 * document's balance stands. On the date (the regular server run, or "Apply
 * due cheques") it is paid straight to the bank:
 *   received, on an invoice   Dr bank / Cr Receivables
 *   given, on a bill          Dr Payables / Cr bank
 * and the cheque shows Deposited / Presented. A cheque that then bounces (or
 * is stopped) has that payment reversed, so the document owes again.
 *
 * Applying is idempotent (payment key "cheque:<id>"), so a run that is
 * repeated or overlaps never pays twice. Kept in its own table, created on
 * first use, so no change to the cheques table is needed.
 */

export type ScheduleState = 'scheduled' | 'applied' | 'reversed' | 'skipped'

let ready: Promise<void> | null = null
function ensureTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS cheque_schedules (
          cheque_id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          bank_account_id TEXT,
          state TEXT NOT NULL DEFAULT 'scheduled',
          payment_id TEXT,
          message TEXT,
          applied_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_cheque_schedules_invoice ON cheque_schedules (invoice_id)`
      await sql`CREATE INDEX IF NOT EXISTS idx_cheque_schedules_state ON cheque_schedules (state)`
    })().catch(err => { ready = null; throw err })
  }
  return ready
}

function fail(message: string, status = 409): never {
  throw Object.assign(new Error(message), { status })
}

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

export type ChequeSchedule = {
  chequeId: string
  invoiceId: string
  bankAccountId: string | null
  state: ScheduleState
  paymentId: string | null
  message: string | null
  appliedAt: string | null
}

const toSchedule = (r: Record<string, unknown>): ChequeSchedule => ({
  chequeId: String(r.cheque_id),
  invoiceId: String(r.invoice_id),
  bankAccountId: r.bank_account_id ? String(r.bank_account_id) : null,
  state: String(r.state) as ScheduleState,
  paymentId: r.payment_id ? String(r.payment_id) : null,
  message: r.message ? String(r.message) : null,
  appliedAt: r.applied_at ? new Date(String(r.applied_at)).toISOString() : null,
})

export async function listSchedules(filter?: { invoiceId?: string; chequeIds?: string[] }): Promise<ChequeSchedule[]> {
  await ensureTable()
  const { rows } = filter?.invoiceId
    ? await sql`SELECT * FROM cheque_schedules WHERE invoice_id = ${filter.invoiceId}`
    : filter?.chequeIds
      ? await sql`SELECT * FROM cheque_schedules WHERE cheque_id = ANY(${filter.chequeIds})`
      : await sql`SELECT * FROM cheque_schedules`
  return rows.map(r => toSchedule(r as Record<string, unknown>))
}

async function setState(chequeId: string, state: ScheduleState, extra: { paymentId?: string | null; message?: string | null; applied?: boolean } = {}) {
  await sql`
    UPDATE cheque_schedules SET
      state = ${state},
      payment_id = COALESCE(${extra.paymentId ?? null}, payment_id),
      message = ${extra.message ?? null},
      applied_at = CASE WHEN ${Boolean(extra.applied)} THEN now() ELSE applied_at END,
      updated_at = now()
    WHERE cheque_id = ${chequeId}
  `
}

/** Link a cheque to the invoice / bill it pays on its date, and the bank account it goes through. */
export async function scheduleCheque(input: { chequeId: string; invoiceId: string; bankAccountId: string }) {
  await ensureTable()
  const [cheque, invoice] = await Promise.all([
    prisma.cheque.findUnique({ where: { id: input.chequeId } }),
    prisma.invoice.findUnique({ where: { id: input.invoiceId } }),
  ])
  if (!cheque) fail('Cheque not found', 404)
  if (!invoice) fail('Invoice or bill not found', 404)
  const isBill = invoiceDocumentType(invoice) === 'vendor_bill'
  if (cheque.direction === 'received' && isBill) fail('A cheque we received pays a customer invoice, not a supplier bill', 422)
  if (cheque.direction === 'given' && !isBill) fail('A cheque we gave pays a supplier bill, not a customer invoice', 422)
  if (Number(invoice.totalAmount) <= 0) fail('Pick an invoice or bill, not a credit note', 422)
  if (!input.bankAccountId) fail('Pick the bank account the cheque goes through', 422)
  await cashLabelForBankAccount(prisma, input.bankAccountId) // throws on an unknown or closed account
  await sql`
    INSERT INTO cheque_schedules (cheque_id, invoice_id, bank_account_id, state)
    VALUES (${cheque.id}, ${invoice.id}, ${input.bankAccountId}, 'scheduled')
    ON CONFLICT (cheque_id) DO UPDATE SET invoice_id = EXCLUDED.invoice_id, bank_account_id = EXCLUDED.bank_account_id,
      state = CASE WHEN cheque_schedules.state = 'applied' THEN cheque_schedules.state ELSE 'scheduled' END,
      message = NULL, updated_at = now()
  `
  return { invoiceRef: invoice.invoiceNumber }
}

async function syncInvoiceMirror(invoiceId: string) {
  try {
    const updated = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { amountPaid: true } })
    if (!updated) return
    const state = await loadAppState(['deed_invoices'])
    const mirror = Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, unknown>> : []
    const row = mirror.find(i => i.id === invoiceId)
    const paid = Number(updated.amountPaid)
    if (row && Number(row.amountPaid ?? 0) !== paid) {
      row.amountPaid = paid
      await saveStoreKeys({ deed_invoices: JSON.stringify(mirror) })
    }
  } catch (err) {
    console.error('[cheque-schedule] invoice mirror sync failed:', err)
  }
}

async function refreshScreens() {
  try {
    const { refreshInvoicesBlob } = await import('@/lib/documents-broadcast.server')
    await refreshInvoicesBlob()
  } catch { /* the next load catches up */ }
  await notifyStoreKeysChanged(['deed_journalEntries']).catch(() => {})
}

type ApplyOutcome = { chequeId: string; chequeNumber: string; invoiceRef: string; amount: number; result: 'applied' | 'skipped' | 'waiting'; message?: string }

/**
 * Pay every scheduled cheque whose date has come (Nairobi date), oldest first.
 * A cheque that cannot go yet (document not confirmed, period locked) stays
 * scheduled with the reason and is tried again on the next run.
 */
/**
 * How long cheques take to clear (setting, default 2 working days) and the
 * public holidays to skip, for working out each cheque's clearing day.
 */
export async function clearingRules(): Promise<{ days: number; holidays: string[] }> {
  const [state, holidays] = await Promise.all([
    loadAppState(['deed_systemSettings']).catch(() => ({} as Record<string, unknown>)),
    prisma.publicHoliday.findMany({ select: { holidayDate: true } }).catch(() => [] as Array<{ holidayDate: Date }>),
  ])
  return { days: clearingDaysSetting(state.deed_systemSettings), holidays: holidays.map(h => h.holidayDate.toISOString().slice(0, 10)) }
}

export async function clearsOnFor(chequeDate: Date | string): Promise<string> {
  const rules = await clearingRules()
  return chequeClearsOn(typeof chequeDate === 'string' ? chequeDate : chequeDate.toISOString().slice(0, 10), rules.days, rules.holidays)
}

/**
 * A scheduled cheque goes through two steps:
 *  - on its date it is banked (received) or presented (given): status
 *    "deposited", nothing paid yet;
 *  - on its clearing day (cheque date + the clearing working days) the money
 *    is there: the payment is recorded on the invoice / bill, dated that day,
 *    and the cheque is "cleared".
 * `force` (a person marked it cleared) records the payment now.
 */
export async function applyMaturedCheques(opts: { today?: string; onlyChequeIds?: string[]; force?: boolean } = {}): Promise<ApplyOutcome[]> {
  await ensureTable()
  const today = opts.today ?? nairobiToday()
  const pending = (await listSchedules(opts.onlyChequeIds ? { chequeIds: opts.onlyChequeIds } : undefined)).filter(s => s.state === 'scheduled')
  if (!pending.length) return []
  const rules = await clearingRules()
  const cheques = await prisma.cheque.findMany({ where: { id: { in: pending.map(s => s.chequeId) } } })
  const byId = new Map(cheques.map(c => [c.id, c]))
  const rows = pending
    .map(s => ({ s, c: byId.get(s.chequeId) }))
    .filter((x): x is { s: ChequeSchedule; c: NonNullable<typeof x.c> } => Boolean(x.c))
    .map(x => ({ ...x, dated: x.c.chequeDate.toISOString().slice(0, 10), clears: chequeClearsOn(x.c.chequeDate.toISOString().slice(0, 10), rules.days, rules.holidays) }))
    .sort((a, b) => a.c.chequeDate.getTime() - b.c.chequeDate.getTime())

  const out: ApplyOutcome[] = []
  let changed = false

  // Step 1: dated today or earlier but not clear yet — banked / presented.
  for (const { c, dated, clears } of rows) {
    if (opts.force || c.status !== 'pending' || dated > today || clears <= today) continue
    const history = Array.isArray(c.history) ? c.history as unknown[] : []
    await prisma.cheque.update({
      where: { id: c.id },
      data: {
        status: 'deposited',
        history: [...history, { at: new Date().toISOString(), by: 'System', status: 'deposited', note: `${c.direction === 'given' ? 'Presented' : 'Banked'} on its date; clears ${clears}` }] as never,
      },
    })
    await setState(c.id, 'scheduled', { message: null })
    changed = true
    out.push({ chequeId: c.id, chequeNumber: c.chequeNumber, invoiceRef: '', amount: 0, result: 'waiting', message: `clears ${clears}` })
  }

  // Step 2: cleared — record the payment.
  const due = rows.filter(({ c, clears }) => (opts.force ? ['pending', 'deposited', 'cleared'] : ['pending', 'deposited']).includes(c.status) && (opts.force || clears <= today))
  for (const { s, c, clears } of due) {
    const base = { chequeId: c.id, chequeNumber: c.chequeNumber, invoiceRef: '', amount: 0 }
    try {
      const invoice = await prisma.invoice.findUnique({ where: { id: s.invoiceId } })
      if (!invoice) { await setState(c.id, 'skipped', { message: 'The invoice or bill no longer exists' }); out.push({ ...base, result: 'skipped', message: 'document gone' }); continue }
      base.invoiceRef = invoice.invoiceNumber
      if (!isPayableInvoiceStatus(String(invoice.status)) || invoice.paymentBlocked) {
        await setState(c.id, 'scheduled', { message: `${invoice.invoiceNumber} is not confirmed or its payments are blocked — waiting` })
        out.push({ ...base, result: 'waiting', message: 'document not payable yet' }); continue
      }
      const owed = money(Number(invoice.totalAmount) - Number(invoice.amountPaid))
      if (owed <= 0) {
        await setState(c.id, 'skipped', { message: `${invoice.invoiceNumber} was already paid — the cheque was not applied` })
        out.push({ ...base, result: 'skipped', message: 'already paid' }); continue
      }
      // Dated the day the money is there (today when someone marks it cleared early).
      const paidDay = opts.force ? (clears < today ? clears : today) : clears
      const paidAt = new Date(`${paidDay}T09:00:00+03:00`)
      const lock = await checkFiscalLock(paidAt)
      if (!lock.ok) {
        await setState(c.id, 'scheduled', { message: lock.error ?? 'That period is locked — waiting' })
        out.push({ ...base, result: 'waiting', message: 'period locked' }); continue
      }
      const amount = money(Math.min(Number(c.amount), owed))
      const isBill = invoiceDocumentType(invoice) === 'vendor_bill'
      const bankLabel = s.bankAccountId ? await cashLabelForBankAccount(prisma, s.bankAccountId) : labelForRole('bank_absa')
      const actorId = c.createdBy ?? invoice.createdById
      const { recordPaymentWithAllocations } = await import('@/lib/accounting/payment-allocations')
      const result = await recordPaymentWithAllocations({
        amount,
        paymentMethod: 'cheque',
        reference: `Cheque ${c.chequeNumber}`.slice(0, 80),
        externalReference: c.chequeNumber,
        paidAt,
        notes: `Cheque ${c.chequeNumber}${c.bankName ? ` (${c.bankName})` : ''} cleared ${paidDay} · idempotency:cheque:${c.id}`,
        createdById: actorId,
        invoiceId: invoice.id,
        paymentType: isBill ? 'vendor_payment' : 'customer_receipt',
        partnerId: invoice.clientId,
        bankAccountId: s.bankAccountId,
        currencyCode: invoice.currencyCode,
        exchangeRateToBase: Number(invoice.exchangeRateToBase || 1),
        idempotencyKey: `cheque:${c.id}`,
        allocations: [{ invoiceId: invoice.id, amount }],
        journal: paymentId => ({
          ref: `JRN/CHQ/${invoice.invoiceNumber}/${paymentId}`.slice(0, 80),
          journalCode: 'BNK',
          date: paidAt,
          description: `Cheque ${c.chequeNumber} ${isBill ? 'to supplier' : 'from customer'} for ${invoice.invoiceNumber}`,
          sourceType: 'payment',
          sourceId: paymentId,
          invoiceId: invoice.id,
          paymentId,
          createdById: actorId,
          skipIfExists: true,
          lines: isBill
            ? [
                { accountLabel: labelForRole('ap'), label: `Cheque ${c.chequeNumber} · ${invoice.invoiceNumber}`, debit: amount, credit: 0, partnerId: invoice.clientId },
                { accountLabel: bankLabel, label: `Cheque ${c.chequeNumber} presented`, debit: 0, credit: amount, partnerId: invoice.clientId },
              ]
            : [
                { accountLabel: bankLabel, label: `Cheque ${c.chequeNumber} deposited`, debit: amount, credit: 0, partnerId: invoice.clientId },
                { accountLabel: labelForRole('ar'), label: `Cheque ${c.chequeNumber} · ${invoice.invoiceNumber}`, debit: 0, credit: amount, partnerId: invoice.clientId },
              ],
        }),
        audit: async (tx, paymentRow) => {
          await writeFinancialAuditInTx(tx, {
            userId: actorId,
            action: 'cheque_applied_on_date',
            entityType: 'invoice',
            entityId: invoice.id,
            oldValues: { amountPaid: Number(invoice.amountPaid) },
            newValues: { chequeId: c.id, chequeNumber: c.chequeNumber, amount, paymentId: paymentRow.id, chequeDate: c.chequeDate.toISOString().slice(0, 10), clearedOn: paidDay },
          })
        },
      })
      const short = money(Number(c.amount) - amount)
      await setState(c.id, 'applied', {
        paymentId: result.payment.id,
        applied: true,
        message: short > 0 ? `Only ${amount.toLocaleString('en-KE')} was owed on ${invoice.invoiceNumber}; ${short.toLocaleString('en-KE')} of the cheque was not applied` : null,
      })
      const fresh = await prisma.cheque.findUnique({ where: { id: c.id }, select: { history: true } })
      const history = Array.isArray(fresh?.history) ? fresh!.history as unknown[] : []
      await prisma.cheque.update({
        where: { id: c.id },
        data: {
          status: 'cleared',
          history: [...history, { at: new Date().toISOString(), by: 'System', status: 'cleared', note: `Cleared ${paidDay}; ${invoice.invoiceNumber} paid ${amount.toLocaleString('en-KE')}` }] as never,
        },
      })
      await syncInvoiceMirror(invoice.id)
      changed = true
      out.push({ ...base, amount, result: 'applied', ...(short > 0 ? { message: `only ${amount} owed` } : {}) })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed'
      console.error(`[cheque-schedule] cheque ${c.chequeNumber} not applied:`, message)
      await setState(c.id, 'scheduled', { message: `Not applied yet: ${message}` }).catch(() => {})
      out.push({ ...base, result: 'waiting', message })
    }
  }
  if (changed) await refreshScreens()
  return out
}

/**
 * A cheque that bounced or was stopped after it was applied: reverse its
 * payment, so the invoice or bill owes again. Nothing to do if it was never
 * applied (the schedule is just closed).
 */
export async function undoChequePayment(chequeId: string, reason: string, actor: { id: string; name: string }) {
  // No schedule table reachable means no schedule for this cheque: the status change goes on.
  const [s] = await listSchedules({ chequeIds: [chequeId] }).catch(() => [] as ChequeSchedule[])
  if (!s) return { reversed: false }
  if (s.state !== 'applied' || !s.paymentId) {
    if (s.state === 'scheduled') await setState(chequeId, 'skipped', { message: `Not applied: ${reason}` })
    return { reversed: false }
  }
  const { reverseInvoicePayment } = await import('@/lib/accounting/payment-reversal.server')
  await reverseInvoicePayment({ invoiceId: s.invoiceId, paymentId: s.paymentId, reason, actor })
  await setState(chequeId, 'reversed', { message: reason })
  await syncInvoiceMirror(s.invoiceId)
  await refreshScreens()
  return { reversed: true }
}

/** A bounced / stopped cheque put back to Held (re-presented): it pays its document on the next run again. */
export async function reopenChequeSchedule(chequeId: string) {
  await ensureTable().catch(() => {})
  await sql`UPDATE cheque_schedules SET state = 'scheduled', payment_id = NULL, message = NULL, updated_at = now()
            WHERE cheque_id = ${chequeId} AND state IN ('reversed', 'skipped')`.catch(() => {})
}
