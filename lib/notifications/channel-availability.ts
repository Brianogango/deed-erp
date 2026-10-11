import { resolveSmsProvider } from './sms-provider'
import { isSmsPaused } from './outbound-pause'

/** True when the WhatsApp Cloud API credentials are present. */
function whatsappConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim() && String(env.WHATSAPP_ACCESS_TOKEN || '').trim())
}

/**
 * Phone channels that can actually deliver right now. Customer notices only
 * queue WhatsApp/SMS when a provider is configured (and SMS is not paused),
 * so an unconfigured provider no longer logs a failed attempt (and dead
 * letter) per message, and customers fall back to email instead.
 */
export function configuredPhoneChannels(): Array<'whatsapp' | 'sms'> {
  const out: Array<'whatsapp' | 'sms'> = []
  if (whatsappConfigured()) out.push('whatsapp')
  if (resolveSmsProvider() && !isSmsPaused()) out.push('sms')
  return out
}
