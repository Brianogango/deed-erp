export type StkCallbackResult = {
  merchantRequestId: string
  checkoutRequestId: string
  resultCode: number
  resultDesc: string
  amount?: number
  mpesaReceipt?: string
  phone?: string
  transactionDate?: string
}

type CallbackItem = { Name?: string; Value?: string | number }

function itemsToMap(items: CallbackItem[] | undefined): Map<string, string | number> {
  const map = new Map<string, string | number>()
  for (const item of items ?? []) {
    if (item?.Name != null && item.Value != null) map.set(String(item.Name), item.Value)
  }
  return map
}

/** Parse a Daraja STK callback body. Returns null if the payload is not an STK callback. */
export function parseStkCallback(body: unknown): StkCallbackResult | null {
  const stk = (body as { Body?: { stkCallback?: Record<string, unknown> } } | null)?.Body?.stkCallback
  if (!stk || typeof stk !== 'object') return null
  const merchantRequestId = String(stk.MerchantRequestID || '').trim()
  const checkoutRequestId = String(stk.CheckoutRequestID || '').trim()
  if (!merchantRequestId || !checkoutRequestId) return null
  const resultCode = Number(stk.ResultCode)
  const resultDesc = String(stk.ResultDesc || '')
  const meta = itemsToMap((stk.CallbackMetadata as { Item?: CallbackItem[] } | undefined)?.Item)
  const amountRaw = meta.get('Amount')
  const receipt = meta.get('MpesaReceiptNumber')
  const phone = meta.get('PhoneNumber')
  const txDate = meta.get('TransactionDate')
  return {
    merchantRequestId,
    checkoutRequestId,
    resultCode: Number.isFinite(resultCode) ? resultCode : -1,
    resultDesc,
    amount: amountRaw != null ? Number(amountRaw) : undefined,
    mpesaReceipt: receipt != null ? String(receipt) : undefined,
    phone: phone != null ? String(phone) : undefined,
    transactionDate: txDate != null ? String(txDate) : undefined,
  }
}

export function stkStatusFromResultCode(resultCode: number): 'success' | 'cancelled' | 'failed' {
  if (resultCode === 0) return 'success'
  if (resultCode === 1032) return 'cancelled'
  return 'failed'
}
