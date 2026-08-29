import 'server-only'

import type { MpesaConfig } from './config'
import { darajaStkPassword, darajaTimestamp } from './password'

type TokenCache = { token: string; expiresAt: number }
let tokenCache: TokenCache | null = null

export type StkPushInput = {
  phone: string
  amount: number
  accountReference: string
  transactionDesc: string
}

export type StkPushAccepted = {
  merchantRequestId: string
  checkoutRequestId: string
  responseCode: string
  responseDescription: string
  customerMessage: string
}

export type StkQueryResult = {
  responseCode: string
  resultCode: string
  resultDesc: string
  merchantRequestId: string
  checkoutRequestId: string
}

async function darajaFetch(cfg: MpesaConfig, path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const desc = (json as { errorMessage?: string; error_description?: string } | null)?.errorMessage
      || (json as { error_description?: string } | null)?.error_description
      || `Daraja HTTP ${res.status}`
    throw Object.assign(new Error(desc), { status: res.status >= 400 && res.status < 500 ? res.status : 502 })
  }
  return json
}

export async function getDarajaAccessToken(cfg: MpesaConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token
  const basic = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`, 'utf8').toString('base64')
  const json = await darajaFetch(cfg, '/oauth/v1/generate?grant_type=client_credentials', {
    method: 'GET',
    headers: { Authorization: `Basic ${basic}` },
  }) as { access_token?: string; expires_in?: string | number }
  const token = String(json.access_token || '')
  if (!token) throw Object.assign(new Error('Daraja did not return an access token'), { status: 502 })
  const ttl = Number(json.expires_in) || 3599
  tokenCache = { token, expiresAt: Date.now() + ttl * 1000 }
  return token
}

export async function initiateStkPush(cfg: MpesaConfig, input: StkPushInput): Promise<StkPushAccepted> {
  const token = await getDarajaAccessToken(cfg)
  const timestamp = darajaTimestamp()
  const password = darajaStkPassword(cfg.shortcode, cfg.passkey, timestamp)
  const amount = Math.round(Number(input.amount))
  if (!Number.isFinite(amount) || amount < 1) {
    throw Object.assign(new Error('Amount must be at least KES 1'), { status: 400 })
  }
  const json = await darajaFetch(cfg, '/mpesa/stkpush/v1/processrequest', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: cfg.transactionType,
      Amount: String(amount),
      PartyA: input.phone,
      PartyB: cfg.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: cfg.callbackUrl,
      AccountReference: String(input.accountReference).slice(0, 12) || 'DEED',
      TransactionDesc: String(input.transactionDesc).slice(0, 13) || 'Payment',
    }),
  }) as {
    MerchantRequestID?: string
    CheckoutRequestID?: string
    ResponseCode?: string
    ResponseDescription?: string
    CustomerMessage?: string
    errorMessage?: string
  }
  if (String(json.ResponseCode) !== '0' || !json.CheckoutRequestID) {
    throw Object.assign(new Error(json.errorMessage || json.ResponseDescription || 'STK push was rejected'), { status: 422 })
  }
  return {
    merchantRequestId: String(json.MerchantRequestID),
    checkoutRequestId: String(json.CheckoutRequestID),
    responseCode: String(json.ResponseCode),
    responseDescription: String(json.ResponseDescription || ''),
    customerMessage: String(json.CustomerMessage || json.ResponseDescription || ''),
  }
}

export async function queryStkPush(cfg: MpesaConfig, checkoutRequestId: string): Promise<StkQueryResult> {
  const token = await getDarajaAccessToken(cfg)
  const timestamp = darajaTimestamp()
  const password = darajaStkPassword(cfg.shortcode, cfg.passkey, timestamp)
  const json = await darajaFetch(cfg, '/mpesa/stkpushquery/v1/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  }) as {
    ResponseCode?: string
    ResultCode?: string
    ResultDesc?: string
    MerchantRequestID?: string
    CheckoutRequestID?: string
    errorMessage?: string
  }
  return {
    responseCode: String(json.ResponseCode ?? ''),
    resultCode: String(json.ResultCode ?? ''),
    resultDesc: String(json.ResultDesc || json.errorMessage || ''),
    merchantRequestId: String(json.MerchantRequestID || ''),
    checkoutRequestId: String(json.CheckoutRequestID || checkoutRequestId),
  }
}
