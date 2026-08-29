export type MpesaPublicStatus = {
  configured: boolean
  env: 'sandbox' | 'production'
  shortcode: string | null
}

export type StkClientRecord = {
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

async function readJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => null) as T & { error?: string } | null
  if (!res.ok) {
    throw new Error(payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `M-Pesa request failed (${res.status})`)
  }
  return payload as T
}

export async function fetchMpesaStatus(): Promise<MpesaPublicStatus> {
  const res = await fetch('/api/mpesa/status')
  return readJson<MpesaPublicStatus>(res)
}

export async function sendMpesaStk(input: {
  phone: string
  amount: number
  accountReference: string
  transactionDesc: string
  source: 'pos' | 'invoice'
  invoiceId?: string
}): Promise<StkClientRecord> {
  const res = await fetch('/api/mpesa/stk-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return readJson<StkClientRecord>(res)
}

export async function queryMpesaStk(checkoutRequestId: string): Promise<StkClientRecord> {
  const res = await fetch('/api/mpesa/stk-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkoutRequestId }),
  })
  return readJson<StkClientRecord>(res)
}

export async function waitForMpesaStk(
  checkoutRequestId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<StkClientRecord> {
  const timeoutMs = opts?.timeoutMs ?? 90_000
  const intervalMs = opts?.intervalMs ?? 3_000
  const started = Date.now()
  let last: StkClientRecord | null = null
  while (Date.now() - started < timeoutMs) {
    last = await queryMpesaStk(checkoutRequestId)
    if (last.status !== 'pending') return last
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return last ?? {
    checkoutRequestId,
    merchantRequestId: '',
    phone: '',
    amount: 0,
    status: 'failed',
    resultCode: null,
    resultDesc: 'Timed out waiting for the customer to complete the prompt',
    mpesaReceipt: null,
  }
}
