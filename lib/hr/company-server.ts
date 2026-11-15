import 'server-only'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS } from '@/lib/store'
import { loadLogoForPdfServer } from '@/lib/pdf-logo.server'
import { pdfCompany } from '@/lib/pdf-company'
import type { DeedPdfCompanyInput } from '@/lib/deed-document-pdf'

/**
 * Company letterhead for documents built on the server (e-mailed payslips and
 * offer letters), with the same logo and print settings a download gets.
 */
export async function companyForPdf(): Promise<DeedPdfCompanyInput> {
  const state = await loadAppState(['deed_companySettings']).catch(() => ({} as Record<string, unknown>))
  const saved = (state.deed_companySettings ?? {}) as Record<string, unknown>
  const co = { ...DEFAULT_COMPANY_SETTINGS, ...saved }
  const logo = await loadLogoForPdfServer(typeof co.logoUrl === 'string' ? co.logoUrl : null)
  return {
    ...pdfCompany(co, logo),
    name: co.name || process.env.COMPANY_NAME || 'Deed Technologies',
  }
}
