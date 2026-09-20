import { NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/company-info
 * Public — returns display-only company contact info for the customer portal.
 */
export async function GET() {
  try {
    const state = await loadAppState(['deed_companySettings'])
    const saved = state['deed_companySettings'] as Record<string, unknown> | undefined
    const settings = { ...DEFAULT_COMPANY_SETTINGS, ...(saved ?? {}) }
    return NextResponse.json({
      name:    settings.name,
      phone:   settings.phone,
      email:   settings.email,
      website: settings.website,
      address: settings.address,
      city:    settings.city,
      mpesaPaybill: settings.mpesaPaybill,
      mpesaAccount: settings.mpesaAccount,
    })
  } catch {
    return NextResponse.json({
      name:    DEFAULT_COMPANY_SETTINGS.name,
      phone:   DEFAULT_COMPANY_SETTINGS.phone,
      email:   DEFAULT_COMPANY_SETTINGS.email,
      website: DEFAULT_COMPANY_SETTINGS.website,
      address: DEFAULT_COMPANY_SETTINGS.address,
      city:    DEFAULT_COMPANY_SETTINGS.city,
      mpesaPaybill: DEFAULT_COMPANY_SETTINGS.mpesaPaybill,
      mpesaAccount: DEFAULT_COMPANY_SETTINGS.mpesaAccount,
    })
  }
}
