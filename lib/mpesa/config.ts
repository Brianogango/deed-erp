export type MpesaEnv = 'sandbox' | 'production'

export type MpesaConfig = {
  env: MpesaEnv
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  shortcode: string
  passkey: string
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'
  callbackUrl: string
}

export function mpesaConfigured(cfg: Partial<MpesaConfig> | null | undefined): cfg is MpesaConfig {
  return Boolean(
    cfg?.consumerKey
    && cfg?.consumerSecret
    && cfg?.shortcode
    && cfg?.passkey
    && cfg?.callbackUrl,
  )
}

export function loadMpesaConfig(): MpesaConfig | null {
  const env: MpesaEnv = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox'
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || '').trim()
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || '').trim()
  const shortcode = (process.env.MPESA_SHORTCODE || '').trim()
  const passkey = (process.env.MPESA_PASSKEY || '').trim()
  const transactionType = process.env.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline'
    ? 'CustomerBuyGoodsOnline'
    : 'CustomerPayBillOnline'
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  const callbackUrl = (process.env.MPESA_CALLBACK_URL || (appUrl ? `${appUrl}/api/mpesa/callback` : '')).trim()
  const cfg: Partial<MpesaConfig> = {
    env,
    baseUrl: env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    transactionType,
    callbackUrl,
  }
  return mpesaConfigured(cfg) ? cfg as MpesaConfig : null
}

export function mpesaPublicStatus() {
  const cfg = loadMpesaConfig()
  return {
    configured: Boolean(cfg),
    env: cfg?.env ?? 'sandbox',
    shortcode: cfg?.shortcode ?? null,
  }
}
