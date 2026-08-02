// The companies API returns raw Prisma `clients` rows (kraPin, addressLine1,
// creditLimit as a string, isActive …) while the CRM UI works with the richer
// client `Company` shape (taxId, physicalAddress, numeric creditLimit,
// status: 'active' | 'inactive' | 'suspended'). Rows reach the client store
// from several paths — boot fetch, the app_state cross-device sync, and
// localStorage snapshots written by older builds — so normalization happens
// once at the store choke point. Without it, `company.status` is undefined
// and the CRM → Companies tab crashed every render ("Cannot read properties
// of undefined (reading 'replace')" inside Badge).

const CLIENT_STATUSES = new Set(['active', 'inactive', 'suspended'])

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, ''))
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

export function normalizeCompanyForClient(raw: any) {
  if (!raw || typeof raw !== 'object') return raw

  const rawStatus = typeof raw.status === 'string' ? raw.status : undefined
  const status = rawStatus && CLIENT_STATUSES.has(rawStatus)
    ? rawStatus
    : (raw.isActive === false ? 'inactive' : 'active')

  return {
    ...raw,
    name: raw.name ?? raw.companyName ?? '',
    tradingName: raw.tradingName ?? raw.companyName ?? undefined,
    taxId: raw.taxId ?? raw.kraPin ?? raw.registrationNumber ?? '',
    email: raw.email ?? '',
    phone: raw.phone ?? '',
    physicalAddress: raw.physicalAddress ?? raw.addressLine1 ?? '',
    postalAddress: raw.postalAddress ?? raw.addressLine2 ?? undefined,
    city: raw.city ?? '',
    country: raw.country ?? 'Kenya',
    segment: raw.segment ?? undefined,
    industry: raw.industry ?? undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    creditLimit: toFiniteNumber(raw.creditLimit),
    creditUsed: toFiniteNumber(raw.creditUsed ?? raw.creditBalance),
    paymentTerms: raw.paymentTerms ?? raw.paymentTermsDays ?? undefined,
    status,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date().toISOString(),
  }
}

export function normalizeCompaniesForClient(rawCompanies: any[]) {
  return Array.isArray(rawCompanies)
    ? rawCompanies.map(normalizeCompanyForClient)
    : []
}
