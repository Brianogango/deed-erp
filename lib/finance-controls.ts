/**
 * Client-safe finance control helpers (Phases A–C hybrid seals).
 * Admin Officer may post customer invoices and vendor bills with no amount cap,
 * and may pay customer invoices. Paying vendor bills, bank recon, cancel/reset,
 * and expense reimbursement stay Finance/Director.
 */

export const DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES = 1_000_000

export type FinanceRole =
  | 'director'
  | 'admin_officer'
  | 'finance_officer'
  | string

export function normalizeFinanceRole(role: string | null | undefined): string {
  if (!role) return ''
  const aliases: Record<string, string> = {
    super_admin: 'director',
    admin: 'director',
    finance: 'finance_officer',
  }
  return aliases[role] || role
}

/** Full finance seal — bank recon, cancel/reset invoice, expense reimbursement. */
export function isFullFinanceRole(role: string | null | undefined): boolean {
  const r = normalizeFinanceRole(role)
  return r === 'director' || r === 'finance_officer'
}

/** Roles that may create draft customer invoices from SO. */
export function canCreateCustomerInvoiceRole(role: string | null | undefined): boolean {
  const r = normalizeFinanceRole(role)
  return r === 'director' || r === 'finance_officer' || r === 'admin_officer'
}

export function resolveAdminOfficerInvoiceLimit(limitKes?: number | null): number {
  const n = Number(limitKes)
  if (Number.isFinite(n) && n > 0) return Math.round(n)
  return DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES
}

/**
 * Admin Officer may post customer invoices and vendor bills with no amount cap,
 * and may pay customer invoices. Paying vendor bills stays Finance/Director.
 * `invoiceTotal` / `limitKes` are unused here (kept for call-site compatibility);
 * the former Admin Officer amount cap is gone. SoD still uses the threshold.
 */
export function canPostOrPayCustomerInvoice(args: {
  role: string | null | undefined
  invoiceType: string
  invoiceTotal?: number
  limitKes?: number | null
  action?: 'post' | 'pay'
}): { ok: boolean; reason?: string } {
  const role = normalizeFinanceRole(args.role)
  if (!role) return { ok: false, reason: 'Not signed in' }

  if (isFullFinanceRole(role)) return { ok: true }

  if (role === 'admin_officer') {
    const action = args.action ?? 'post'
    if (args.invoiceType === 'vendor_bill' && action === 'pay') {
      return { ok: false, reason: 'Only Finance or Director can pay vendor bills' }
    }
    if (args.invoiceType === 'customer_invoice' || args.invoiceType === 'vendor_bill') {
      return { ok: true }
    }
    return { ok: false, reason: 'Only Finance or Director can post/pay this document type' }
  }

  return { ok: false, reason: 'Insufficient role to post or take payment' }
}

export function canManageBankRecon(role: string | null | undefined): boolean {
  return isFullFinanceRole(role)
}

export function canCancelOrResetInvoice(role: string | null | undefined): boolean {
  return isFullFinanceRole(role)
}

export function canReviewExpense(role: string | null | undefined): boolean {
  return isFullFinanceRole(role)
}

export function canReimburseExpense(role: string | null | undefined): boolean {
  return isFullFinanceRole(role)
}

/**
 * SoD: above the threshold, the user who posted cannot also register payment
 * unless they are Director (break-glass).
 */
export function canPayOwnPostedInvoice(args: {
  role: string | null | undefined
  actorUserId?: string | null
  postedByUserId?: string | null
  invoiceTotal: number
  sodThresholdKes?: number | null
}): { ok: boolean; reason?: string } {
  const role = normalizeFinanceRole(args.role)
  if (role === 'director') return { ok: true }
  const threshold = resolveAdminOfficerInvoiceLimit(args.sodThresholdKes)
  if ((Number(args.invoiceTotal) || 0) <= threshold) return { ok: true }
  if (
    args.actorUserId &&
    args.postedByUserId &&
    args.actorUserId === args.postedByUserId
  ) {
    return {
      ok: false,
      reason: `Segregation of duties: invoices over KES ${threshold.toLocaleString('en-KE')} must be paid by a different Finance user than the poster`,
    }
  }
  return { ok: true }
}

/** Deterministic payment journal ref — prevents double GL on retry. */
export function paymentJournalRef(invoiceRef: string, paymentId: string): string {
  return `JRN/PAY/${invoiceRef}/${paymentId}`
}

/**
 * Append-only merge for journal ledgers: existing refs are immutable and are
 * never deleted. Incoming may add new refs (including REV/ reversals).
 *
 * A client's local ledger is frequently only a partial view of the server's:
 * a stale snapshot, or a set that has not yet caught up on refs another user
 * posted since the client last hydrated (especially while the key is stuck in
 * the client's pending-sync queue, which blocks incoming SSE updates for it).
 * Such a client is NOT trying to delete the refs it omits, so treating a
 * missing ref as a deletion and rejecting the write is wrong: it deadlocks the
 * client's sync and — because the store flushes every dirty key in one batch —
 * silently drops co-bundled writes such as POS orders and invoices. We instead
 * preserve every server ref the client omitted by unioning it back in.
 */
export function mergeAppendOnlyJournals(
  existing: unknown,
  incoming: unknown,
): { ok: true; merged: unknown[] } | { ok: false; error: string } {
  const prev = Array.isArray(existing) ? existing as Array<{ ref?: string }> : []
  const next = Array.isArray(incoming) ? incoming as Array<{ ref?: string }> : null
  if (!next) return { ok: false, error: 'Journal payload must be an array' }

  const prevByRef = new Map<string, unknown>()
  for (const row of prev) {
    const ref = typeof row?.ref === 'string' ? row.ref : ''
    if (ref) prevByRef.set(ref, row)
  }

  const nextRefs = new Set<string>()
  for (const row of next) {
    const ref = typeof row?.ref === 'string' ? row.ref : ''
    if (!ref) continue
    nextRefs.add(ref)
    if (prevByRef.has(ref)) {
      const before = JSON.stringify(prevByRef.get(ref))
      const after = JSON.stringify(row)
      if (before !== after) {
        return { ok: false, error: `Posted journal ${ref} is immutable` }
      }
    }
  }

  // Preserve server-only refs the incoming payload omitted (never delete),
  // then keep the incoming order for everything the client did send.
  const merged: unknown[] = [...next]
  for (const [ref, row] of prevByRef) {
    if (!nextRefs.has(ref)) merged.push(row)
  }
  return { ok: true, merged }
}

/** Normalize a date-like value to YYYY-MM-DD (UTC). */
export function toFiscalDay(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return value.toISOString().slice(0, 10)
  }
  const raw = String(value)
  const dt = raw.includes('T') || raw.includes('Z')
    ? new Date(raw)
    : new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toISOString().slice(0, 10)
}

/**
 * True when the document date is on or before the fiscal lock date.
 * A missing lock date never blocks.
 */
export function isDocumentDateFiscalLocked(
  documentDate: Date | string,
  lockDate: Date | string | null | undefined,
): boolean {
  if (lockDate == null || lockDate === '') return false
  const docDay = toFiscalDay(documentDate)
  const lockDay = toFiscalDay(lockDate)
  if (!docDay || !lockDay) return false
  return docDay <= lockDay
}

export function fiscalLockConflictMessage(lockDate: Date | string): string {
  const lockDay = toFiscalDay(lockDate)
  return `Fiscal period locked through ${lockDay} — backdated documents are not allowed`
}
