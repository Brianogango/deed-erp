import { NextRequest, NextResponse } from 'next/server'
import { guardPortalRoute } from '@/lib/portal/portal-guard.server'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS } from '@/lib/store'
import { warrantyByToken } from '@/lib/warranty/e-warranty.server'
import { maskedName, warrantyState } from '@/lib/warranty/e-warranty'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }
const noStore = { 'Cache-Control': 'no-store' }

/** Public: the certificate behind an e-warranty link. The buyer's name is shortened. */
export const GET = guardPortalRoute('warranty', 120, async (_req: NextRequest, { params }: Params) => {
  const { token } = await params
  const w = await warrantyByToken(token)
  if (!w) return NextResponse.json({ error: 'This warranty link is not valid.' }, { status: 404, headers: noStore })
  const state = await loadAppState(['deed_companySettings'])
  const company = { ...DEFAULT_COMPANY_SETTINGS, ...((state.deed_companySettings as Record<string, unknown>) ?? {}) } as Record<string, any>
  return NextResponse.json({
    warranty: {
      ref: w.ref,
      buyer: maskedName(w.customerName === 'Walk-in customer' ? '' : w.customerName),
      productName: w.productName,
      serialNumber: w.serialNumber,
      specs: w.specs ?? '',
      document: w.saleOrderRef,
      startDate: w.startDate.slice(0, 10),
      endDate: w.endDate.slice(0, 10),
      months: w.months,
      state: warrantyState(w),
    },
    company: { name: company.name, phone: company.phone, email: company.email, website: company.website, address: company.address, city: company.city },
  }, { headers: noStore })
})
