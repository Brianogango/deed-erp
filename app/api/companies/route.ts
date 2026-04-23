import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Company } from '@/lib/store'

const config = {
  storeKey: 'deed_companies',
  build: (body: Record<string, unknown>): Company | string => {
    if (!body.name) return 'name is required'
    return {
      id: `comp_${Date.now()}`,
      name: String(body.name),
      taxId: String(body.taxId ?? ''),
      email: String(body.email ?? ''),
      phone: String(body.phone ?? ''),
      physicalAddress: String(body.physicalAddress ?? ''),
      city: String(body.city ?? ''),
      country: 'Kenya',
      paymentTerms: 30,
      creditLimit: 0,
      creditUsed: 0,
      tags: [],
      status: 'active',
      kycStatus: 'pending',
      createdDate: new Date().toISOString().slice(0, 10),
      createdBy: '',
      ...(body as Partial<Company>),
    } as Company
  },
  filter: (items: Company[], params: URLSearchParams) => {
    let result = items
    const status = params.get('status')
    const q = params.get('q')?.toLowerCase()
    if (status) result = result.filter(c => c.status === status)
    if (q) result = result.filter(c =>
      c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    )
    return result
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
