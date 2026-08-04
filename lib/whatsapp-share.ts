/**
 * Client-side WhatsApp share helpers (wa.me deep links).
 *
 * Opens the staff member's WhatsApp (phone app or WhatsApp Web) with a chat
 * to the customer and an optional pre-filled message. Does not require the
 * Meta Cloud API — the "from" number is whatever account is logged in locally.
 */

/** Digits only, Kenya-aware (+254 / 0XXXXXXXXX → 254…). */
export function whatsappPhoneDigits(phone: string | null | undefined): string | null {
  let cleaned = String(phone ?? '').replace(/\D/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('0') && cleaned.length >= 9) {
    cleaned = `254${cleaned.slice(1)}`
  } else if (cleaned.startsWith('254')) {
    // already international without +
  } else if (cleaned.length === 9) {
    cleaned = `254${cleaned}`
  }
  // wa.me needs country code + national number, no leading +
  if (cleaned.length < 10) return null
  return cleaned
}

export function buildRepairTrackingWhatsAppMessage(opts: {
  clientName: string
  trackingUrl: string
}): string {
  const name = String(opts.clientName ?? '').trim() || 'valued customer'
  const link = String(opts.trackingUrl ?? '').trim()
  return [
    `Hello ${name},`,
    '',
    'Your device repair is currently in progress. You can track its status and view the latest updates using the link below:',
    '',
    link,
    '',
    'We will continue updating the portal as the repair progresses. If you have any questions, please feel free to contact us through the portal or reply to this message.',
    '',
    'Thank you for choosing Deed Technologies.',
  ].join('\n')
}

/** Returns null when the phone cannot be normalised. */
export function buildWhatsAppShareUrl(opts: {
  phone: string | null | undefined
  text: string
}): string | null {
  const digits = whatsappPhoneDigits(opts.phone)
  if (!digits) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(opts.text)}`
}

/** Prefer contact-person details on company jobs; fall back to customer. */
export function resolveRepairWhatsAppRecipient(repair: {
  customerName?: string | null
  customerPhone?: string | null
  contactPersonName?: string | null
  contactPersonPhone?: string | null
}): { name: string; phone: string } | null {
  const phone = String(repair.contactPersonPhone || repair.customerPhone || '').trim()
  if (!whatsappPhoneDigits(phone)) return null
  const name = String(repair.contactPersonName || repair.customerName || '').trim() || 'valued customer'
  return { name, phone }
}
