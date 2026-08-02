import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { upsertContact } from '@/lib/contact-prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/partners/migrate-suppliers
 * Copies Prisma Supplier rows into unified Client/Contact vendors (isVendor=true).
 * Purchase already uses Contact.isVendor at runtime; this retires the dual model in practice.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer'])

    const suppliers = await prisma.supplier.findMany({ where: { isActive: true } }).catch(() => [])
    const state = await loadAppState(['deed_contacts'])
    const contacts = ([...(Array.isArray(state['deed_contacts']) ? state['deed_contacts'] : [])] as Array<Record<string, unknown>>)

    let createdOrUpdated = 0
    let markedVendors = 0
    const errors: string[] = []

    for (const s of suppliers) {
      const name = (s.name || '').trim()
      if (!name) continue
      try {
        const result = await upsertContact(prisma, {
          type: 'company',
          name,
          email: s.email || '',
          phone: s.phone || '',
          address: s.addressLine1 || '',
          city: s.city || '',
          country: s.country || 'Kenya',
          vatNumber: s.kraPin || '',
          isCustomer: false,
          isVendor: true,
          paymentTermsDays: s.paymentTerms ?? 30,
          bankDetails: [s.bankName, s.bankAccount].filter(Boolean).join(' · '),
          notes: s.notes || `Migrated from supplier ${s.supplierNumber}`,
          tags: ['migrated-supplier'],
        })
        if (typeof result === 'string') {
          errors.push(`${s.supplierNumber}: ${result}`)
          continue
        }
        createdOrUpdated++
        const contact = result.contact
        const idx = contacts.findIndex(c => c.id === contact.id || String(c.name || '').toLowerCase() === name.toLowerCase())
        if (idx >= 0) {
          if (!contacts[idx].isVendor) markedVendors++
          contacts[idx] = { ...contacts[idx], ...contact, isVendor: true }
        } else {
          contacts.unshift({ ...contact, isVendor: true })
        }
      } catch (err) {
        errors.push(`${s.supplierNumber}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }

    await saveStoreKeys({ deed_contacts: JSON.stringify(contacts) })

    return NextResponse.json({
      ok: true,
      supplierCount: suppliers.length,
      createdOrUpdated,
      markedVendors,
      errors,
      note: 'Vendors now live on Client/Contact (isVendor). Assign POs to these contacts; Supplier table kept for legacy FK rows only.',
    })
  })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'finance_officer'])
    const supplierCount = await prisma.supplier.count().catch(() => 0)
    const vendorClients = await prisma.client.count({ where: { isVendor: true } }).catch(() => 0)
    return NextResponse.json({ ok: true, supplierCount, vendorClients })
  })
}
