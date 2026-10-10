import 'server-only'
import { loadAppState } from '@/lib/server-store'

/** Company details for letters and PDFs generated on the server. */
export async function companyForPdf() {
  const state = await loadAppState(['deed_companySettings']).catch(() => ({} as Record<string, unknown>))
  const c = (state.deed_companySettings ?? {}) as Record<string, string | undefined>
  return {
    name: c.name || process.env.COMPANY_NAME || 'Deed Technologies',
    address: c.address, city: c.city, phone: c.phone, email: c.email, kraPin: c.kraPin,
  }
}
