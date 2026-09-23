import 'server-only'

import prisma from '@/lib/prisma'
import { parseStkCallback, stkStatusFromResultCode } from './callback'
import { loadMpesaConfig } from './config'
import { initiateStkPush, queryStkPush } from './daraja'
import { normalizeMpesaPhone } from './phone'
import { isUuid } from '@/lib/legacy-compat'

export type StkRecord = {
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

export async function refreshStkRequest(checkoutRequestId: string): Promise<StkRecord | null> {
  const existing = await prisma.mpesaStkRequest.findUnique({ where: { checkoutRequestId } })
  if (!existing) return null
  if (existing.status !== 'pending') return toRecord(existing)

  const cfg = loadMpesaConfig()
  if (!cfg) return toRecord(existing)

  try {
    const queried = await queryStkPush(cfg, checkoutRequestId)
    const terminal = new Set(['0', '1', '1032', '1037', '2001', '1001'])
    if (!terminal.has(queried.resultCode)) return toRecord(existing)
    const code = Number(queried.resultCode)
    const status = stkStatusFromResultCode(code)
    const updated = await prisma.mpesaStkRequest.update({
      where: { checkoutRequestId },
      data: {
        status,
        resultCode: queried.resultCode,
        resultDesc: queried.resultDesc.slice(0, 200),
      },
    })
    return toRecord(updated)
  } catch {
    return toRecord(existing)
  }
}

export async function applyStkCallback(body: unknown): Promise<StkRecord | null> {
  const parsed = parseStkCallback(body)
  if (!parsed) return null
  const status = stkStatusFromResultCode(parsed.resultCode)
  const existing = await prisma.mpesaStkRequest.findUnique({
    where: { checkoutRequestId: parsed.checkoutRequestId },
  })
  if (!existing) return null
  const updated = await prisma.mpesaStkRequest.update({
    where: { checkoutRequestId: parsed.checkoutRequestId },
    data: {
      status,
      resultCode: String(parsed.resultCode),
      resultDesc: parsed.resultDesc.slice(0, 200),
      mpesaReceipt: parsed.mpesaReceipt ?? existing.mpesaReceipt,
      rawCallback: body as object,
    },
  })
  return toRecord(updated)
}
