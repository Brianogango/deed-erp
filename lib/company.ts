// ── Deed Technologies Ltd — Company constants ─────────────────────────────────
// CO provides hardcoded defaults. Always prefer companySettings from the store
// (useApp) in React components. Use getStoredCompanyData() in utility functions.

export const CO = {
  name:         'Deed Technologies LTD',
  address:      'Sanlam House, Kenyatta Avenue',
  city:         'Nairobi 6690-20200',
  country:      'Kenya',
  phone:        '0113407964',
  kraPin:       'P051999898X',
  website:      'http://deed.africa',
  email:        'info@deed.africa',

  // Banking
  bankName:     'NCBA BANK KENYA PLC',
  bankAccount:  '1005157785',
  bankBranch:   'EASTLEIGH BRANCH',
  bankCode:     '07000',
  branchCode:   '221',
  swiftCode:    'CBAFKENX',

  // M-Pesa
  mpesaPaybill: '880100',
  mpesaAccount: '468778',

  // Brand colours
  cyan:   '#00B0D7',
  navy:   '#1B2762',
} as const

// ── Dynamic company data ──────────────────────────────────────────────────────
// Reads companySettings from localStorage and merges with CO defaults.
// Use this in utility/lib files that cannot call React hooks.
export function getStoredCompanyData() {
  let stored: Partial<typeof CO & { logoUrl: string; invoiceFooter: string }> = {}
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('deed_companySettings')
      if (raw) stored = JSON.parse(raw)
    } catch { /* corrupted — use defaults */ }
  }
  return {
    name:         stored.name         ?? CO.name,
    address:      stored.address      ?? CO.address,
    city:         stored.city         ?? CO.city,
    country:      CO.country,
    phone:        stored.phone        ?? CO.phone,
    kraPin:       stored.kraPin       ?? CO.kraPin,
    website:      stored.website      ?? CO.website,
    email:        stored.email        ?? CO.email,
    mpesaPaybill: stored.mpesaPaybill ?? CO.mpesaPaybill,
    mpesaAccount: stored.mpesaAccount ?? CO.mpesaAccount,
    logoUrl:      stored.logoUrl      ?? '',
    invoiceFooter: (stored as any).invoiceFooter ?? '',
    navy:         CO.navy,
    cyan:         CO.cyan,
  }
}

// ── Active bank accounts ──────────────────────────────────────────────────────
// Returns all active bank accounts from localStorage (for utility functions).
export function getStoredBankAccounts(): { id: string; name: string; bankName: string; accountNo: string }[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem('deed_bankAccounts')
    if (raw) {
      const accounts = JSON.parse(raw) as { id: string; name: string; bankName: string; accountNo: string; active: boolean }[]
      return accounts.filter(a => a.active)
    }
  } catch { /* corrupted */ }
  return []
}
