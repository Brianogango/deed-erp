import 'server-only'

import prisma from '@/lib/prisma'
import { parseStkCallback, stkStatusFromResultCode } from './callback'
import { loadMpesaConfig } from './config'
import { initiateStkPush, queryStkPush } from './daraja'
import { normalizeMpesaPhone } from './phone'
import { isUuid } from '@/lib/legacy-compat'

type StkRecord = {
  checkoutRequestId: string
  merchantRequestId: string
  phone: string
  amount: number
  status: string
  resultCode: string | null
  resultDesc: string | null
  mpesaReceipt: string | null
  customerMessage?: string
}

function toRecord(row: {
  checkoutRequestId: string
  merchantRequestId: string
  phone: string
  amount: unknown
  status: string
  resultCode: string | null
  resultDesc: string | null
  mpesaReceipt: string | null
}): StkRecord {
  const amount = Number(row.amount)
  return {
    checkoutRequestId: row.checkoutRequestId,
    merchantRequestId: row.merchantRequestId,
    phone: row.phone,
    amount,
    status: row.status,
    resultCode: row.resultCode,
    resultDesc: row.resultDesc,
    mpesaReceipt: row.mpesaReceipt,
  }
}

export async function startStkPush(input: {
  phone: string
  amount: number
  accountReference: string
  transactionDesc: string
  source: 'pos' | 'invoice'
  invoiceId?: string | null
  createdById?: string | null
}): Promise<StkRecord> {
  const cfg = loadMpesaConfig()
  if (!cfg) {
    throw Object.assign(new Error('M-Pesa Daraja is not configured on this server'), { status: 503 })
  }
  const phone = normalizeMpesaPhone(input.phone)
  if (!phone) {
    throw Object.assign(new Error('Enter a valid Safaricom number (07XX or 2547XX)'), { status: 400 })
  }
  const accepted = await initiateStkPush(cfg, {
    phone,
    amount: input.amount,
    accountReference: input.accountReference,
    transactionDesc: input.transactionDesc,
  })
  const row = await prisma.mpesaStkRequest.create({
    data: {
      merchantRequestId: accepted.merchantRequestId,
      checkoutRequestId: accepted.checkoutRequestId,
      phone,
      amount: Math.round(Number(input.amount)),
      accountReference: String(input.accountReference).slice(0, 12) || 'DEED',
      description: String(input.transactionDesc).slice(0, 80) || 'Payment',
      source: input.source,
      // The STK prompt has already been pushed to the customer's phone: a
      // non-uuid blob invoice id must not throw away the request record.
      invoiceId: isUuid(input.invoiceId) ? input.invoiceId : null,
      createdById: input.createdById && /^[0-9a-f-]{36}$/i.test(input.createdById) ? input.createdById : null,
      status: 'pending',
    },
  })
  return { ...toRecord(row), customerMessage: accepted.customerMessage }
}

const TERMINAL_RESULT_CODES = new Set(['0', '1', '1032', '1037', '2001', '1001'])

/**
 * The receipt number from a stored callback, when that callback is for this
 * request and the amount it reports is the amount asked for.
 */
function receiptFromStoredCallback(row: { merchantRequestId: string; amount: unknown; rawCallback?: unknown }): string | null {
  const parsed = row.rawCallback ? parseStkCallback(row.rawCallback) : null
  if (!parsed || parsed.merchantRequestId !== row.merchantRequestId) return null
  if (parsed.amount === undefined || Math.round(parsed.amount) !== Math.round(Number(row.amount))) return null
  return parsed.mpesaReceipt ?? null
}

/**
 * Settle a pending request from Daraja's own STK Query. Only a pending row
 * moves, and only once (the update is conditional on status 'pending').
 */
async function settleFromDaraja(checkoutRequestId: string) {
  const existing = await prisma.mpesaStkRequest.findUnique({ where: { checkoutRequestId } })
  if (!existing) return null
  if (existing.status !== 'pending') return existing

  const cfg = loadMpesaConfig()
  if (!cfg) return existing
  try {
    const queried = await queryStkPush(cfg, checkoutRequestId)
    if (!TERMINAL_RESULT_CODES.has(queried.resultCode)) return existing
    const status = stkStatusFromResultCode(Number(queried.resultCode))
    await prisma.mpesaStkRequest.updateMany({
      where: { checkoutRequestId, status: 'pending' },
      data: {
        status,
        resultCode: queried.resultCode,
        resultDesc: queried.resultDesc.slice(0, 200),
        ...(status === 'success' ? { mpesaReceipt: receiptFromStoredCallback(existing) ?? existing.mpesaReceipt } : {}),
      },
    })
    return await prisma.mpesaStkRequest.findUnique({ where: { checkoutRequestId } })
  } catch {
    return existing
  }
}

export async function refreshStkRequest(checkoutRequestId: string): Promise<StkRecord | null> {
  const row = await settleFromDaraja(checkoutRequestId)
  return row ? toRecord(row) : null
}

/**
 * Safaricom's callback is unauthenticated, so it is only a signal to check:
 * the outcome always comes from Daraja's STK Query. The callback is stored
 * (for its receipt number) only when it names this request's merchant id
 * and, for a payment, the amount asked for.
 */
export async function applyStkCallback(body: unknown): Promise<StkRecord | null> {
  const parsed = parseStkCallback(body)
  if (!parsed) return null
  const existing = await prisma.mpesaStkRequest.findUnique({
    where: { checkoutRequestId: parsed.checkoutRequestId },
  })
  if (!existing) return null
  if (existing.status !== 'pending') return toRecord(existing)
  if (parsed.merchantRequestId !== existing.merchantRequestId) return null
  if (parsed.resultCode === 0 && (parsed.amount === undefined || Math.round(parsed.amount) !== Math.round(Number(existing.amount)))) {
    return toRecord(existing)
  }
  await prisma.mpesaStkRequest.updateMany({
    where: { checkoutRequestId: parsed.checkoutRequestId, status: 'pending' },
    data: { rawCallback: body as object },
  })
  const settled = await settleFromDaraja(parsed.checkoutRequestId)
  return settled ? toRecord(settled) : null
}
