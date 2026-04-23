import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Contact } from '@/lib/store'

const config = {
  storeKey: 'deed_contacts',
  build: (body: Record<string, unknown>): Contact | string => {
    if (!body.name) return 'name is required'
    return {
      id: `cont_${Date.now()}`,
      type: 'individual',
      name: String(body.name),
      email: String(body.email ?? ''),
      phone: String(body.phone ?? ''),
      address: String(body.address ?? ''),
      isCustomer: Boolean(body.isCustomer ?? true),
      isVendor: Boolean(body.isVendor ?? false),
      isActive: true,
      createdDate: new Date().toISOString().slice(0, 10),
      ...(body as Partial<Contact>),
    } as Contact
  },
  filter: (items: Contact[], params: URLSearchParams) => {
    let result = items
    const type = params.get('type') // 'customer' | 'vendor' | 'individual' | 'company'
    const q = params.get('q')?.toLowerCase()
    if (type === 'customer') result = result.filter(c => c.isCustomer)
    else if (type === 'vendor') result = result.filter(c => c.isVendor)
    if (q) result = result.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q)
    )
    return result
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
