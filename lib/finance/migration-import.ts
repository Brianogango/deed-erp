/**
 * Finance → Migration: customers, suppliers and their opening balances from
 * an old system's spreadsheet.
 *
 * Pure planning only. The page then creates each contact through
 * /api/contacts (the contacts table is the source of truth; the store's
 * contact list is rebuilt from it) and each opening balance through the
 * normal posted-invoice path, so the journal is posted once per document.
 *
 * Re-importing the same file is safe: a contact is matched by name, and an
 * opening balance already in the books (same kind, partner and reference —
 * or, without a reference, same partner, amount and date) is skipped.
 */

type Row = Record<string, unknown>

type MigrationContactInput = {
  name: string
  type: 'company' | 'individual'
  email: string
  phone: string
  address: string
  city: string
  country: string
  vatNumber: string
  isCustomer: boolean
  isVendor: boolean
  tags: string[]
}

type MigrationDocument = {
  /** Lower-cased contact name; resolves to an id once the contact exists. */
  contactKey: string
  partnerName: string
  type: 'customer_invoice' | 'vendor_bill'
  ref: string
  date: string
  dueDate: string
  amount: number
  description: string
  notes: string
}

type MigrationPlan = {
  /** Contacts that do not exist yet, by lower-cased name. */
  contactsToCreate: Map<string, MigrationContactInput>
  /** Existing contact ids, by lower-cased name. */
  existingContactIds: Map<string, string>
  documents: MigrationDocument[]
  skipped: string[]
  errors: string[]
}

type ExistingContact = { id: string; name: string }
type ExistingInvoice = { type?: string; ref?: string; partnerId?: string; partnerName?: string; total?: number; date?: string; status?: string }

const VENDOR_KINDS = ['vendor', 'supplier', 'bill', 'ap', 'payable']
const CUSTOMER_KINDS = ['customer', 'client', 'invoice', 'ar', 'receivable']

function cell(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const direct = row[key]
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim()
    const actualKey = Object.keys(row).find(candidate => candidate.trim().toLowerCase() === key.trim().toLowerCase())
    const value = actualKey ? row[actualKey] : undefined
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

/**
 * A spreadsheet date as YYYY-MM-DD. Excel stores typed dates as day numbers
 * (46300 = 2026-10-05), which the server rejects as an invalid date; day-first
 * text (05/10/2026) is how dates are written here. Null when unreadable.
 */
export function migrationDate(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^\d{4,6}(\.\d+)?$/.test(value)) {
    const serial = Number(value)
    if (serial < 20000 || serial > 80000) return null
    const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000
    return new Date(ms).toISOString().slice(0, 10)
  }
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]))
  m = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]))
  return null
}

function validYmd(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

function amountOf(raw: string): number {
  return Number(raw.replace(/[,\s]/g, '').replace(/^KES/i, '')) || 0
}

const key = (v: unknown) => String(v ?? '').trim().toLowerCase()

export function planMigrationImport(
  rows: Row[],
  opts: { contacts: ExistingContact[]; invoices: ExistingInvoice[]; today: string },
): MigrationPlan {
  const existingContactIds = new Map(opts.contacts.map(c => [key(c.name), c.id]))
  const contactsToCreate = new Map<string, MigrationContactInput>()
  const documents: MigrationDocument[] = []
  const skipped: string[] = []
  const errors: string[] = []

  const live = opts.invoices.filter(i => i.status !== 'cancelled')
  const partnerOf = (i: ExistingInvoice) => key(i.partnerName)
  const alreadyBooked = (doc: MigrationDocument) => live.some(i =>
    i.type === doc.type
    && partnerOf(i) === doc.contactKey
    && (doc.ref
      ? key(i.ref) === key(doc.ref)
      : Math.round(Number(i.total) || 0) === Math.round(doc.amount) && String(i.date ?? '').slice(0, 10) === doc.date),
  ) || documents.some(d => d.type === doc.type && d.contactKey === doc.contactKey
    && (doc.ref ? key(d.ref) === key(doc.ref) : d.amount === doc.amount && d.date === doc.date))

  rows.forEach((row, index) => {
    const at = `Row ${index + 2}`
    const name = cell(row, 'Name', 'Contact', 'Customer', 'Vendor', 'Supplier')
    if (!name) {
      errors.push(`${at}: Name is required`)
      return
    }
    const kind = cell(row, 'Kind', 'Type', 'Contact Type').toLowerCase()
    if (kind && !VENDOR_KINDS.includes(kind) && !CUSTOMER_KINDS.includes(kind)) {
      errors.push(`${at}: Kind "${kind}" is not customer or vendor`)
      return
    }
    const isVendor = VENDOR_KINDS.includes(kind)
    const balance = amountOf(cell(row, 'Opening Balance', 'Balance', 'Amount', 'Outstanding'))
    if (balance < 0) {
      errors.push(`${at}: Opening Balance cannot be negative`)
      return
    }
    const dateRaw = cell(row, 'Date', 'Document Date')
    const dueRaw = cell(row, 'Due Date', 'Due')
    const date = dateRaw ? migrationDate(dateRaw) : opts.today
    const dueDate = dueRaw ? migrationDate(dueRaw) : date
    if (balance > 0 && (!date || !dueDate)) {
      errors.push(`${at}: date "${!date ? dateRaw : dueRaw}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)`)
      return
    }
    if (balance > 0 && dueDate! < date!) {
      errors.push(`${at}: Due Date is before Date`)
      return
    }

    const contactKey = key(name)
    if (!existingContactIds.has(contactKey)) {
      const prev = contactsToCreate.get(contactKey)
      if (prev) {
        // The same name on a customer row and a supplier row is one contact.
        prev.isVendor ||= isVendor
        prev.isCustomer ||= !isVendor
      } else {
        contactsToCreate.set(contactKey, {
          name,
          type: isVendor ? 'company' : 'individual',
          email: cell(row, 'Email'),
          phone: cell(row, 'Phone', 'Mobile'),
          address: cell(row, 'Address'),
          city: cell(row, 'City') || 'Nairobi',
          country: cell(row, 'Country') || 'Kenya',
          vatNumber: cell(row, 'VAT Number', 'PIN', 'KRA PIN'),
          isCustomer: !isVendor,
          isVendor,
          tags: ['migration'],
        })
      }
    }

    if (balance <= 0) return
    const doc: MigrationDocument = {
      contactKey,
      partnerName: name,
      type: isVendor ? 'vendor_bill' : 'customer_invoice',
      ref: cell(row, 'Reference', 'Ref', 'Document Ref'),
      date: date!,
      dueDate: dueDate!,
      amount: Math.round(balance * 100) / 100,
      description: cell(row, 'Description') || 'Opening balance migrated from previous system',
      notes: cell(row, 'Notes') || 'Opening balance migrated from previous system',
    }
    if (alreadyBooked(doc)) {
      skipped.push(`${at}: ${doc.ref || `${name} ${doc.amount}`} is already in the books`)
      return
    }
    documents.push(doc)
  })

  return { contactsToCreate, existingContactIds, documents, skipped, errors }
}
