// Ownership verification helpers for the public customer portal.
//
// Portal repair endpoints are reachable without a session and are addressed by
// a repair reference. References are somewhat guessable, so any state-changing
// portal action (approving a quote, confirming payment) additionally requires
// the caller to prove they are the customer by supplying the phone number on
// file. The phone is masked in the public GET payload so knowing the reference
// alone does not reveal the secret.

/** Reduce a phone number to comparable digits (last 9, ignoring +254/0 prefixes). */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits.slice(-9)
}

/** True when the supplied phone matches the stored phone (lenient on prefix/format). */
export function phoneMatches(input: string | null | undefined, stored: string | null | undefined): boolean {
  const a = normalizePhone(input)
  const b = normalizePhone(stored)
  return a.length === 9 && a === b
}

/** Mask a phone for display, e.g. "0712345678" -> "07******78". */
export function maskPhone(phone: string | null | undefined): string {
  const raw = String(phone ?? '')
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) return '*'.repeat(digits.length)
  const head = digits.slice(0, 2)
  const tail = digits.slice(-2)
  return `${head}${'*'.repeat(Math.max(2, digits.length - 4))}${tail}`
}

/**
 * Portal quote approve / payment confirmation require phone proof by default.
 * Admins must explicitly set secPortalRequirePhoneVerification to false to disable
 * (audit SEC-005 / AGENT-SEC-003).
 */
export function isPortalPhoneVerificationRequired(
  settings?: { secPortalRequirePhoneVerification?: boolean } | null,
): boolean {
  return settings?.secPortalRequirePhoneVerification !== false
}

/**
 * Read-side gate for portal document endpoints (invoice/receipt PDFs, payment
 * proof, photos, reports). A repair ref is guessable, so these require either
 * a staff session or the customer phone on file (?phone=). Returns true when
 * access is allowed.
 */
export async function portalDocumentAccessAllowed(
  req: { url: string },
  repair: { customerPhone?: string | null } | null | undefined,
  opts: { session?: unknown; phoneVerificationRequired?: boolean } = {},
): Promise<boolean> {
  if (opts.session) return true
  if (opts.phoneVerificationRequired === false) return true
  if (!repair) return false
  const phone = new URL(req.url).searchParams.get('phone')
  return phoneMatches(phone, repair.customerPhone)
}
