/**
 * A contact person IS an individual contact who works at a company.
 *
 * These were two separate stores wearing the same label: the company edit form
 * wrote a contact_persons table, while the contact detail panel filtered the
 * directory for individuals with an employer. Neither screen could see the
 * other's data, and the clients table had no employer column at all, so the
 * panel showed zero for every company no matter what was entered.
 *
 * The directory is now the single source. This derives the ContactPerson shape
 * that CRM's existing call sites expect — opportunity and contract pickers,
 * LeadScore, the client and opportunity detail panels — so none of them had to
 * change. Ids are the contact's own id, which is what keeps
 * opportunity.contactPersonId resolving after the migration.
 */

export type DerivedContactPerson = {
  id: string
  clientId: string
  companyId: string
  companyName?: string
  firstName: string
  lastName: string
  fullName: string
  jobTitle?: string
  email: string
  phone: string
  mobile?: string
  notes?: string
  createdDate?: string
}

type ContactLike = {
  id?: unknown
  type?: unknown
  name?: unknown
  companyId?: unknown
  jobTitle?: unknown
  email?: unknown
  phone?: unknown
  mobile?: unknown
  notes?: unknown
  createdAt?: unknown
  isArchived?: unknown
}

/**
 * Split a display name into first/last for the CRM pickers, which render
 * `${firstName} ${lastName}`. Everything after the first token is the surname,
 * so "Mary" alone keeps working and "Jean Paul Mwangi" does not lose a name.
 */
export function splitContactName(name: string): { firstName: string; lastName: string } {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export function deriveContactPersons(
  contacts: readonly ContactLike[] | null | undefined,
  companyNameById?: (id: string) => string | undefined,
): DerivedContactPerson[] {
  const out: DerivedContactPerson[] = []
  for (const contact of contacts ?? []) {
    if (contact?.type !== 'individual') continue
    if (contact?.isArchived === true) continue
    const companyId = typeof contact.companyId === 'string' ? contact.companyId.trim() : ''
    if (!companyId) continue
    const id = typeof contact.id === 'string' ? contact.id : ''
    if (!id) continue

    const fullName = String(contact.name ?? '').trim()
    const { firstName, lastName } = splitContactName(fullName)
    out.push({
      id,
      // Both spellings: CRM reads clientId in some places and companyId in
      // others, and they mean the same company.
      clientId: companyId,
      companyId,
      companyName: companyNameById?.(companyId),
      firstName,
      lastName,
      fullName,
      jobTitle: typeof contact.jobTitle === 'string' && contact.jobTitle.trim()
        ? contact.jobTitle.trim()
        : undefined,
      email: typeof contact.email === 'string' ? contact.email : '',
      phone: typeof contact.phone === 'string' ? contact.phone : '',
      mobile: typeof contact.mobile === 'string' && contact.mobile ? contact.mobile : undefined,
      notes: typeof contact.notes === 'string' && contact.notes ? contact.notes : undefined,
      createdDate: typeof contact.createdAt === 'string' ? contact.createdAt : undefined,
    })
  }
  return out
}

/** The contact shape a contact person is saved as. */
export function contactFromPersonInput(input: {
  id?: string
  companyId: string
  firstName?: string
  lastName?: string
  fullName?: string
  jobTitle?: string
  email?: string
  phone?: string
  mobile?: string
  notes?: string
}): Record<string, unknown> {
  const name = (input.fullName ?? `${input.firstName ?? ''} ${input.lastName ?? ''}`).trim()
  return {
    ...(input.id ? { id: input.id } : {}),
    type: 'individual',
    name,
    companyId: input.companyId,
    jobTitle: input.jobTitle?.trim() || undefined,
    email: input.email?.trim() ?? '',
    phone: input.phone?.trim() ?? '',
    mobile: input.mobile?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    // A contact person is a person at a customer; the directory defaults the
    // rest and the company itself carries the commercial terms.
    isCustomer: true,
    isVendor: false,
    address: '',
    tags: [] as string[],
  }
}
