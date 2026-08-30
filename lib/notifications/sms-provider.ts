/** Resolve which SMS transport the ERP should use. */

export type SmsProviderName = 'telerivet' | 'twilio'

export function resolveSmsProvider(): SmsProviderName | null {
  const forced = String(process.env.SMS_PROVIDER || '').trim().toLowerCase()
  if (forced === 'telerivet' || forced === 'twilio') return forced

  if (process.env.TELERIVET_API_KEY && process.env.TELERIVET_PROJECT_ID) return 'telerivet'
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    return 'twilio'
  }
  return null
}
