'use client'
import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import { useCrmStore, Contact, SaleOrder, RepairOrder, Invoice, POSOrder, fmtDate, fmtDateTime, fmtKes } from '@/lib/store'
import { invoiceDocState, invoicePaymentStatus, isOpenInvoice, invoiceResidual, displayDocRef, PAYMENT_STATUS_LABELS, isQuotationStage } from '@/lib/odoo-sales-flow'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import { Badge, Modal, InfoRow, ModuleSkeleton } from '@/components/ui'
import { PrimaryActionButton, SecondaryActionMenu, ModuleChrome, PageToolbar } from '@/components/erp'
import Chatter from '@/components/erp/Chatter'
import { DataTable, type ColumnDef } from '@/components/data-table'
import ContactFormModal, {
  blankCompanyContact,
  blankIndividualContact,
  type ContactFormValues,
} from '@/components/contacts/ContactFormModal'
import {
  Fa, faUsers, faCartShopping,
  faPen, faPlus, faScrewdriverWrench, faFileInvoiceDollar,
  faCashRegister, faInbox, faFileArrowDown, faCheck, faTriangleExclamation, faXmark,
} from '@/components/icons'
import { useUrlQueryState, useUrlRecordId } from '@/hooks/useUrlRecordId'
import {
  creditBalancesByCustomer,
  creditsForCustomer,
  customerCreditSourceLabel,
  customerCreditStatusLabel,
} from '@/lib/customer-credit-view'

type FilterTab = 'all' | 'companies' | 'individuals' | 'customers' | 'vendors'
type ViewTab   = 'info' | 'financial' | 'persons' | 'history' | 'chatter'

function contactToFormValues(c: Contact): ContactFormValues {
  const { id: _id, createdAt: _createdAt, ...rest } = c
  return rest
}

function contactInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'C'
}

const contactSoColumns: ColumnDef<SaleOrder>[] = [
  { key: 'ref', label: 'Ref', priority: 1, width: '100px', render: so => <span className="font-mono text-[11px] font-semibold text-primary-600">{so.ref ?? so.orderNumber ?? so.id.slice(0, 8)}</span>, accessor: so => so.ref ?? so.orderNumber ?? so.id },
  { key: 'date', label: 'Date', priority: 2, width: '100px', render: so => <span className="text-xs text-t3">{fmtDate(so.date)}</span>, accessor: so => so.date },
  { key: 'items', label: 'Items', priority: 1, width: '1.4fr', render: so => {
    const items = (so.lines ?? []).map(l => l.productName).join(', ')
    return <span className="text-xs text-t2 truncate" title={items}>{items}</span>
  }, accessor: so => (so.lines ?? []).map(l => l.productName).join(' ') },
  { key: 'total', label: 'Total', priority: 1, width: '100px', align: 'right', render: so => <span className="font-mono text-[11px]">{fmtKes(so.total)}</span>, accessor: so => so.total },
  { key: 'invoiced', label: 'Invoiced', priority: 3, width: '80px', render: so => <span className="text-[10px]" style={{ color: so.invoiceId ? 'var(--success)' : 'var(--text-3)' }}>{so.invoiceId ? 'Yes' : 'No'}</span>, accessor: so => so.invoiceId ? 'Yes' : 'No' },
  { key: 'status', label: 'Status', priority: 1, width: '120px', render: so => <Badge status={so.status} size="xs" />, accessor: so => so.status },
]

const contactRepairColumns: ColumnDef<RepairOrder>[] = [
  { key: 'ref', label: 'Ref', priority: 1, width: '100px', render: r => <span className="font-mono text-[11px] font-semibold text-primary-600">{r.ref}</span>, accessor: r => r.ref },
  { key: 'date', label: 'Booked', priority: 2, width: '140px', render: r => <span className="text-xs text-t3">{fmtDateTime(r.intakeDate)}</span>, accessor: r => r.intakeDate },
  { key: 'device', label: 'Device', priority: 1, width: '1fr', render: r => (
    <div className="min-w-0">
      <p className="truncate text-xs text-t1" title={r.productName}>{r.productName}</p>
      {r.serialNumber && <p className="text-[9px] font-mono text-t3">{r.serialNumber}</p>}
    </div>
  ), accessor: r => `${r.productName} ${r.serialNumber ?? ''}` },
  { key: 'issue', label: 'Issue', priority: 2, width: '1fr', render: r => <span className="text-xs text-t2 truncate">{r.issueDescription}</span>, accessor: r => r.issueDescription },
  { key: 'cost', label: 'Cost', priority: 1, width: '90px', align: 'right', render: r => <span className="font-mono text-[11px]" style={{ color: r.total > 0 ? 'var(--success)' : 'var(--text-3)' }}>{r.total > 0 ? fmtKes(r.total) : '—'}</span>, accessor: r => r.total },
  { key: 'status', label: 'Status', priority: 1, width: '120px', render: r => <Badge status={r.status} size="xs" />, accessor: r => r.status },
]

const contactInvoiceColumns: ColumnDef<Invoice>[] = [
  { key: 'ref', label: 'Ref', priority: 1, width: '100px', render: inv => <span className="font-mono text-[11px] font-semibold text-primary-600">{displayDocRef(inv.ref)}</span>, accessor: inv => inv.ref },
  { key: 'date', label: 'Date', priority: 2, width: '90px', render: inv => <span className="text-xs text-t3">{fmtDate(inv.date)}</span>, accessor: inv => inv.date },
  { key: 'due', label: 'Due', priority: 3, width: '90px', render: inv => <span className="text-xs text-t3">{fmtDate(inv.dueDate)}</span>, accessor: inv => inv.dueDate },
  { key: 'total', label: 'Total', priority: 1, width: '90px', align: 'right', render: inv => <span className="font-mono text-[11px]">{fmtKes(inv.total)}</span>, accessor: inv => inv.total },
  { key: 'paid', label: 'Paid', priority: 2, width: '90px', align: 'right', render: inv => <span className="font-mono text-[11px]" style={{ color: 'var(--success)' }}>{fmtKes(inv.amountPaid)}</span>, accessor: inv => inv.amountPaid },
  { key: 'status', label: 'Status', priority: 1, width: '130px', render: inv => {
    const outstanding = inv.total - inv.amountPaid
    const doc = invoiceDocState(inv.status)
    return (
      <div className="flex flex-col gap-0.5">
        <Badge
          status={doc === 'posted' ? invoicePaymentStatus(inv) : doc}
          label={doc === 'posted' ? PAYMENT_STATUS_LABELS[invoicePaymentStatus(inv)] : undefined}
          size="xs"
        />
        {outstanding > 0 && doc !== 'cancelled' && (
          <span className="text-[9px] font-mono" style={{ color: 'var(--danger)' }}>-{fmtKes(outstanding)}</span>
        )}
      </div>
    )
  }, accessor: inv => inv.status },
]

const contactPosColumns: ColumnDef<POSOrder>[] = [
  { key: 'ref', label: 'Ref', priority: 1, width: '100px', render: tx => <span className="font-mono text-[11px] font-semibold text-primary-600">{tx.ref}</span>, accessor: tx => tx.ref },
  { key: 'date', label: 'Date', priority: 2, width: '100px', render: tx => <span className="text-xs text-t3">{fmtDate(tx.date)}</span>, accessor: tx => tx.date },
  { key: 'items', label: 'Items', priority: 1, width: '1.4fr', render: tx => {
    const items = (tx.lines ?? []).map(l => l.productName).join(', ')
    return <span className="text-xs text-t2 truncate" title={items}>{items}</span>
  }, accessor: tx => (tx.lines ?? []).map(l => l.productName).join(' ') },
  { key: 'total', label: 'Total', priority: 1, width: '100px', align: 'right', render: tx => <span className="font-mono text-[11px]">{fmtKes(tx.total)}</span>, accessor: tx => tx.total },
  { key: 'payment', label: 'Payment', priority: 2, width: '90px', render: tx => <span className="text-[10px] text-t2 capitalize">{tx.payment}</span>, accessor: tx => tx.payment },
]

// ── CSV helpers ──────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(row => {
    let inQuote = false
    const vals: string[] = []
    let curr = ''
    for (let i = 0; i < row.length; i++) {
      const char = row[i]
      if (char === '"') { inQuote = !inQuote }
      else if (char === ',' && !inQuote) { vals.push(curr.trim()); curr = '' }
      else { curr += char }
    }
    vals.push(curr.trim())
    
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i]?.replace(/^"|"$/g, '') ?? '' })
    return obj
  }).filter(r => Object.values(r).some(v => v))
}

function downloadCSV(filename: string, content: string) {
  const bom = '\uFEFF'
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

type ImportContactRow = {
  raw: Record<string, string>
  type: 'company' | 'individual'
  name: string
  email: string
  phone: string
  address: string
  city: string
  vatNumber: string
  isCustomer: boolean
  isVendor: boolean
  status: 'ok' | 'error' | 'exists'
  message: string
}

export default function Contacts() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <ContactsInner />
    </Suspense>
  )
}

function ContactsInner() {
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => { setMounted(true) }, [])

  const { contacts, addContact,
    saleOrders, invoices, repairs, posOrders, customerCredits, showToast, users, currentUserId } = useCrmStore()
  const currentUser = users.find(u => u.id === currentUserId)
  const [tabValue, setTabValue] = useUrlQueryState('tab', 'all')
  const tab: FilterTab = ['all', 'companies', 'individuals', 'customers', 'vendors'].includes(tabValue)
    ? tabValue as FilterTab
    : 'all'
  const setTab = (next: FilterTab) => setTabValue(next)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState<ImportContactRow[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [viewContactId, setViewContactId] = useUrlRecordId({ clearKeys: ['contactTab'] })
  const viewContact = viewContactId ? contacts.find(c => c.id === viewContactId) ?? null : null
  const setViewContact = (c: Contact | null) => setViewContactId(c?.id ?? null)
  const [formDraft, setFormDraft] = useState<ContactFormValues>(blankCompanyContact())
  const [formKey, setFormKey] = useState(0)
  const [viewTabValue, setViewTabValue] = useUrlQueryState('contactTab', 'info')
  const viewTab: ViewTab = ['info', 'financial', 'persons', 'history', 'chatter'].includes(viewTabValue)
    ? viewTabValue as ViewTab
    : 'info'
  const setViewTab = (next: ViewTab) => setViewTabValue(next)

  const [showArchived, setShowArchived] = useState(false)
  const filtered = contacts.filter(c => {
    if (!showArchived && c.isArchived) return false
    const q = search.toLowerCase()
    const matchSearch = !q
      || c.name.toLowerCase().includes(q)
      || (c.tradingName ?? '').toLowerCase().includes(q)
      || c.email.toLowerCase().includes(q)
      || c.phone.includes(q)
      || (c.mobile ?? '').includes(q)
      || (c.vatNumber ?? '').toLowerCase().includes(q)
      || (c.idNumber ?? '').includes(q)
      || (c.city ?? '').toLowerCase().includes(q)
    const matchTab =
      tab === 'all'         ? true :
      tab === 'companies'   ? c.type === 'company' :
      tab === 'individuals' ? c.type === 'individual' :
      tab === 'customers'   ? c.isCustomer :
      tab === 'vendors'     ? c.isVendor : true
    return matchSearch && matchTab
  })

  const creditByCustomer = useMemo(() => creditBalancesByCustomer(customerCredits), [customerCredits])

  const getCompany = (id?: string) => id ? contacts.find(c => c.id === id) : null
  const getLinkedPersons = (companyId: string) => contacts.filter(c => c.companyId === companyId)

  const openNew = (type: 'company' | 'individual') => {
    setFormDraft(type === 'company' ? blankCompanyContact() : blankIndividualContact())
    setEditId(null)
    setFormKey(k => k + 1)
    setShowForm(true)
  }
  const openEdit = (c: Contact) => {
    setFormDraft(contactToFormValues(c))
    setEditId(c.id)
    setFormKey(k => k + 1)
    setShowForm(true)
  }

  const processFile = (file: File) => {
    if (!file.name.endsWith('.csv')) { showToast('Please upload a .csv file', 'error'); return }
    try { guardSpreadsheetFile(file) } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'File too large', 'error'); return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (!parsed.length) { showToast('No data rows found in file', 'error'); return }
      try { guardSpreadsheetRows(parsed) } catch (err) {
        showToast(err instanceof SpreadsheetGuardError ? err.message : 'Too many rows', 'error'); return
      }

      const rows: ImportContactRow[] = parsed.map(raw => {
        const typeRaw = (raw['Type'] ?? '').trim().toLowerCase()
        const type = (typeRaw === 'individual') ? 'individual' : 'company'
        const name = (raw['Name'] ?? '').trim()
        const email = (raw['Email'] ?? '').trim()
        const phone = (raw['Phone'] ?? '').trim()
        const address = (raw['Physical Address'] ?? '').trim()
        const city = (raw['City'] ?? '').trim()
        const vatNumber = (raw['KRA PIN'] ?? '').trim()
        const isCust = (raw['Is Customer'] ?? '').trim().toLowerCase() !== 'no' && (raw['Is Customer'] ?? '').trim().toLowerCase() !== 'false'
        const isVend = (raw['Is Vendor'] ?? '').trim().toLowerCase() === 'yes' || (raw['Is Vendor'] ?? '').trim().toLowerCase() === 'true'

        if (!name) return { raw, type, name, email, phone, address, city, vatNumber, isCustomer: isCust, isVendor: isVend, status: 'error', message: 'Name is required' }

        const exists = contacts.some(c =>
          c.name.toLowerCase() === name.toLowerCase() ||
          (email && c.email && c.email.toLowerCase() === email.toLowerCase()) ||
          (phone && c.phone && c.phone.replace(/\s/g, '') === phone.replace(/\s/g, ''))
        )
        if (exists) return { raw, type, name, email, phone, address, city, vatNumber, isCustomer: isCust, isVendor: isVend, status: 'exists', message: 'Duplicate: name, email, or phone already exists' }

        return { raw, type, name, email, phone, address, city, vatNumber, isCustomer: isCust, isVendor: isVend, status: 'ok', message: 'Valid' }
      })
      setImportRows(rows)
      setShowImport(true)
    }
    reader.readAsText(file)
  }

  const handleConfirmImport = async () => {
    const valid = importRows.filter(r => r.status === 'ok')
    if (!valid.length) { showToast('No valid rows to import', 'error'); return }
    let count = 0
    for (const r of valid) {
      await addContact({
        type: r.type, name: r.name, email: r.email, phone: r.phone, address: r.address,
        city: r.city, vatNumber: r.vatNumber, country: 'Kenya',
        isCustomer: r.isCustomer, isVendor: r.isVendor, tags: [],
      })
      count++
    }
    showToast(`${count} contacts imported successfully`)
    setShowImport(false)
    setImportRows([])
  }

  const downloadTemplate = () => {
    const headers = ['Type', 'Name', 'Email', 'Phone', 'Physical Address', 'City', 'KRA PIN', 'Is Customer', 'Is Vendor']
    const sampleRows = [
      'Company,Acme Corp,acme@example.com,0700000000,Westlands,Nairobi,P123456789X,Yes,No',
      'Individual,John Doe,john@example.com,0711111111,Ngong Road,Nairobi,A123456789X,Yes,No'
    ]
    downloadCSV('deed-erp-contacts-template.csv', [headers.join(','), ...sampleRows].join('\r\n'))
  }

  const total           = contacts.length
  const companiesCount  = contacts.filter(c => c.type === 'company').length
  const individualsCount = contacts.filter(c => c.type === 'individual').length
  const customersCount  = contacts.filter(c => c.isCustomer).length
  const vendorsCount    = contacts.filter(c => c.isVendor).length

  const contactColumns: ColumnDef<Contact>[] = [
    {
      key: 'name', label: 'Contact', priority: 1, width: '1.65fr',
      render: c => {
        const company = getCompany(c.companyId)
        const secondary = c.type === 'company'
          ? (c.tradingName ? `Trading as ${c.tradingName}` : 'Company')
          : [c.jobTitle, company?.name].filter(Boolean).join(' · ') || 'Individual'
        return (
          <div className="contacts-table-person">
            <span className="contacts-avatar contacts-avatar--sm" aria-hidden="true">{contactInitials(c.name)}</span>
            <div className="min-w-0">
              <p className="contacts-table-name">{c.name}</p>
              <p className="contacts-table-meta">{secondary}</p>
            </div>
          </div>
        )
      },
      exportValue: c => c.name,
    },
    {
      key: 'relationship', label: 'Relationship', priority: 1, width: '150px',
      render: c => (
        <div className="contacts-relationship">
          <span className="contacts-kind">{c.type === 'company' ? 'Company' : 'Individual'}</span>
          <div className="contacts-badges">
            {c.isCustomer && <span className="contacts-badge contacts-badge--customer">Customer</span>}
            {c.isVendor && <span className="contacts-badge contacts-badge--vendor">Vendor</span>}
            {c.isArchived && <span className="contacts-badge">Archived</span>}
          </div>
        </div>
      ),
      exportValue: c => [c.type, c.isCustomer && 'Customer', c.isVendor && 'Vendor'].filter(Boolean).join(', '),
    },
    {
      key: 'contact', label: 'Phone & email', priority: 2, width: '1.4fr',
      render: c => (
        <div className="contacts-table-contact">
          <span>{c.phone || c.mobile || 'No phone'}</span>
          <span title={c.email || undefined}>{c.email || 'No email'}</span>
        </div>
      ),
      exportValue: c => `${c.phone || c.mobile || ''} ${c.email || ''}`,
    },
    {
      key: 'location', label: 'Location', priority: 2, width: '120px',
      render: c => <span className="contacts-table-location">{[c.city, c.country].filter(Boolean).join(', ') || '—'}</span>,
      exportValue: c => [c.city, c.country].filter(Boolean).join(', '),
    },
    {
      key: 'storeCredit', label: 'Store credit', priority: 2, width: '110px', align: 'right',
      render: c => {
        const amount = creditByCustomer.get(c.id) ?? 0
        return <span className={`contacts-money ${amount > 0 ? 'contacts-money--positive' : ''}`}>{fmtKes(amount)}</span>
      },
      exportValue: c => creditByCustomer.get(c.id) ?? 0,
    },
    {
      key: 'activity', label: 'Activity', priority: 3, width: '130px',
      render: c => {
        const orders = saleOrders.filter(order => order.customerId === c.id).length
        const jobs = repairs.filter(repair => repair.customerId === c.id).length
        const tills = posOrders.filter(order => order.customerId === c.id).length
        const label = orders ? `${orders} order${orders === 1 ? '' : 's'}` : jobs ? `${jobs} repair${jobs === 1 ? '' : 's'}` : tills ? `${tills} POS sale${tills === 1 ? '' : 's'}` : 'No recent activity'
        return <span className="contacts-activity">{label}</span>
      },
      exportValue: c => saleOrders.filter(order => order.customerId === c.id).length + repairs.filter(repair => repair.customerId === c.id).length + posOrders.filter(order => order.customerId === c.id).length,
    },
  ]

  function contactRowActions(c: Contact) {
    return (
      <div className="contacts-row-actions">
        <button
          className="contacts-row-action"
          onClick={e => { e.stopPropagation(); openEdit(c) }}>
          Edit
        </button>
        {c.isArchived ? (
          <button
            className="contacts-row-action contacts-row-action--success"
            onClick={async e => {
              e.stopPropagation()
              const res = await fetch(`/api/contacts/${c.id}/restore`, { method: 'POST' })
              if (res.ok) {
                const updated = await res.json()
                // force list refresh via updateContact local path
                await fetch(`/api/contacts/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isCustomer: updated.isCustomer }) })
                showToast('Contact restored')
                window.location.reload()
              } else showToast('Could not restore contact', 'error')
            }}>
            Restore
          </button>
        ) : (
          <button
            className="contacts-row-action"
            onClick={async e => {
              e.stopPropagation()
              if (!confirm(`Archive ${c.name}? They stay in history but leave pickers.`)) return
              const res = await fetch(`/api/contacts/${c.id}/archive`, { method: 'POST' })
              if (res.ok) {
                showToast('Contact archived')
                window.location.reload()
              } else showToast('Could not archive contact', 'error')
            }}>
            Archive
          </button>
        )}
      </div>
    )
  }

  function contactCard(c: Contact) {
    const company = getCompany(c.companyId)
    const orders = saleOrders.filter(order => order.customerId === c.id).length
    const jobs = repairs.filter(repair => repair.customerId === c.id).length
    const tills = posOrders.filter(order => order.customerId === c.id).length
    const activity = orders
      ? `${orders} order${orders === 1 ? '' : 's'}`
      : jobs
        ? `${jobs} repair${jobs === 1 ? '' : 's'}`
        : tills
          ? `${tills} POS sale${tills === 1 ? '' : 's'}`
          : 'No recent activity'
    const secondary = c.type === 'company'
      ? (c.tradingName ? `Trading as ${c.tradingName}` : 'Company')
      : [c.jobTitle, company?.name].filter(Boolean).join(' · ') || 'Individual'
    return (
      <article key={c.id} className="contacts-mobile-card" onClick={() => { setViewContact(c); setViewTab('info') }}>
        <div className="contacts-mobile-card__header">
          <span className="contacts-avatar" aria-hidden="true">{contactInitials(c.name)}</span>
          <div className="contacts-mobile-card__identity">
            <p className="contacts-mobile-card__name">{c.name}</p>
            <p className="contacts-mobile-card__type">{secondary}</p>
          </div>
          <div className="contacts-badges contacts-mobile-card__badges">
            {c.isCustomer && <span className="contacts-badge contacts-badge--customer">Customer</span>}
            {c.isVendor && <span className="contacts-badge contacts-badge--vendor">Vendor</span>}
          </div>
        </div>
        <div className="contacts-mobile-card__channels">
          <span className={!c.phone && !c.mobile ? 'is-muted' : ''}>{c.phone || c.mobile || 'No phone'}</span>
          <span className={!c.email ? 'is-muted' : ''}>{c.email || 'No email'}</span>
        </div>
        <div className="contacts-mobile-card__footer">
          <span>{[c.city, c.country].filter(Boolean).join(', ') || 'Location not set'}</span>
          <span className={(creditByCustomer.get(c.id) ?? 0) > 0 ? 'contacts-money--positive' : ''}>
            {(creditByCustomer.get(c.id) ?? 0) > 0 ? `${fmtKes(creditByCustomer.get(c.id))} credit` : activity}
          </span>
        </div>
      </article>
    )
  }

  if (!mounted) return <ModuleSkeleton />

  return (
    <ModuleChrome
      className="contacts-workspace"
      title="Contacts"
      subtitle="Companies, individuals and vendors"
      icon={<Fa icon={faUsers} />}
      count={total}
      primaryAction={
        <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => openNew('individual')} hideLabelOnMobile={false}>
          Add contact
        </PrimaryActionButton>
      }
      overflowActions={
        <SecondaryActionMenu
          actions={[
            { id: 'import', label: 'Import CSV', onClick: () => fileInputRef.current?.click() },
          ]}
        />
      }
      tabs={[
        { id: 'all', label: `All ${total}` },
        { id: 'companies', label: `Companies ${companiesCount}` },
        { id: 'individuals', label: `Individuals ${individualsCount}` },
        { id: 'customers', label: `Customers ${customersCount}` },
        { id: 'vendors', label: `Vendors ${vendorsCount}` },
      ]}
      activeTab={tab}
      onTabChange={id => setTab(id as FilterTab)}
      maxVisibleDesktop={5}
      tabAriaLabel="Contact filters"
    >
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }} />
      <PageToolbar
        search={
          <div className="contacts-toolbar-row">
            <input
              aria-label="Search contacts by name, email, or phone"
              className="form-input contacts-search"
              placeholder="Search name, company, phone or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <label className="contacts-archived-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>
        }
      />
      {/* Contact list */}
      <div className="contacts-directory-card">
        <DataTable
          tableId="contacts"
          columns={contactColumns}
          rows={filtered}
          rowKey={c => c.id}
          hideSearch
          emptyMessage="No contacts found"
          onRowClick={c => { setViewContact(c); setViewTab('info') }}
          rowActions={contactRowActions}
          renderCard={contactCard}
          exportTitle="Contacts"
          exportFilename="contacts"
        />
      </div>

      {/* ── Contact Detail Modal ─────────────────────────────────────────────── */}
      {viewContact && (() => {
        const vc = viewContact
        const company = getCompany(vc.companyId)
        const persons = vc.type === 'company' ? getLinkedPersons(vc.id) : []

        const clientSOs      = saleOrders.filter(s => s.customerId === vc.id)
        const clientInvoices = invoices.filter(i => i.partnerId === vc.id && i.type === 'customer_invoice')
        const clientRepairs  = repairs.filter(r => r.customerId === vc.id)
        const clientPOS      = posOrders.filter(p => p.customerId === vc.id)
        const totalRevenue   = clientInvoices.reduce((s, i) => s + i.amountPaid, 0)
        const openBalance    = clientInvoices.filter(i => isOpenInvoice(i))
                                             .reduce((s, i) => s + invoiceResidual(i), 0)
        const repairRevenue  = clientRepairs.filter(r => r.invoiceId).reduce((s, r) => s + r.total, 0)
        const clientCredits = creditsForCustomer(customerCredits, vc.id)
        const storeCredit = creditByCustomer.get(vc.id) ?? 0
        const historyCount   = clientSOs.length + clientRepairs.length + clientPOS.length + clientInvoices.length
        const recentBusiness = [
          ...clientSOs.map(order => ({
            kind: isQuotationStage(order.status) ? 'Quotation' : 'Sales order',
            ref: order.ref ?? order.orderNumber ?? order.id.slice(0, 8),
            date: order.date,
            amount: order.total,
            status: order.status,
          })),
          ...clientInvoices.map(invoice => ({
            kind: 'Invoice',
            ref: displayDocRef(invoice.ref),
            date: invoice.date,
            amount: invoice.total,
            status: invoiceDocState(invoice.status) === 'posted' ? invoicePaymentStatus(invoice) : invoiceDocState(invoice.status),
          })),
          ...clientRepairs.map(repair => ({
            kind: 'Repair',
            ref: repair.ref,
            date: repair.intakeDate,
            amount: repair.total,
            status: repair.status,
          })),
          ...clientPOS.map(order => ({
            kind: 'POS sale',
            ref: order.ref,
            date: order.date,
            amount: order.total,
            status: 'paid',
          })),
        ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5)

        return (
          <Modal
            title="Contact"
            subtitle={
              vc.type === 'company'
                ? (vc.tradingName ? `${vc.tradingName} · ` : '') + (vc.industry || 'Company')
                : vc.jobTitle
                  ? `${vc.jobTitle}${company ? ` · ${company.name}` : ''}`
                  : company ? company.name : 'Individual'
            }
            width={1280}
            variant="enterprise"
            onClose={() => setViewContact(null)}
          >
            <div className="contacts-profile">
            {/* Header */}
            <div className="contacts-profile__hero">
              <span className="contacts-avatar contacts-avatar--lg" aria-hidden="true">{contactInitials(vc.name)}</span>
              <div className="contacts-profile__identity">
                <h3>{vc.name}</h3>
                <p>
                  {vc.type === 'company'
                    ? [vc.industry || 'Company', vc.city, vc.country].filter(Boolean).join(' · ')
                    : [vc.jobTitle || 'Individual', company?.name, vc.city].filter(Boolean).join(' · ')}
                </p>
                <div className="contacts-badges">
                  <Badge status={vc.type} />
                  {vc.isCustomer && <span className="contacts-badge contacts-badge--customer">Customer</span>}
                  {vc.isVendor && <span className="contacts-badge contacts-badge--vendor">Vendor</span>}
                  {vc.tags.map(t => <span key={t} className="contacts-badge">{t}</span>)}
                </div>
              </div>
              <div className="contacts-profile__actions">
                {vc.phone && <a className="btn-outline" href={`tel:${vc.phone}`}>Call</a>}
                {vc.email && <a className="btn-outline" href={`mailto:${vc.email}`}>Email</a>}
                <button className="btn-outline" onClick={() => { openEdit(vc); setViewContact(null) }}>
                  <Fa icon={faPen} className="mr-1" /> Edit
                </button>
              </div>
            </div>

            <div className="contacts-profile__metrics" aria-label="Account at a glance">
              <div className="contacts-metric">
                <span>Open balance</span>
                <strong>{fmtKes(openBalance)}</strong>
                <small>{clientInvoices.filter(invoice => isOpenInvoice(invoice)).length} open invoice{clientInvoices.filter(invoice => isOpenInvoice(invoice)).length === 1 ? '' : 's'}</small>
              </div>
              <div className="contacts-metric">
                <span>Revenue</span>
                <strong>{fmtKes(totalRevenue)}</strong>
                <small>Invoices collected</small>
              </div>
              <div className="contacts-metric">
                <span>Store credit</span>
                <strong>{fmtKes(storeCredit)}</strong>
                <small>Available to apply</small>
              </div>
              <div className="contacts-metric">
                <span>Activity</span>
                <strong>{clientSOs.length + clientPOS.length} orders · {clientRepairs.length} repairs</strong>
                <small>{historyCount} linked records</small>
              </div>
            </div>

            {/* Sub-tabs */}
            <div className="contacts-profile__tabs scrollbar-hide">
              {([
                ['info',      'Overview'],
                ['financial', 'Financial'],
                ...(vc.type === 'company' ? [['persons', `Contact persons ${persons.length}`]] : []),
                ['history',   `Sales & service ${historyCount}`],
                ['chatter',   'Notes & activity'],
              ] as [ViewTab, string][]).map(([t, label]) => (
                <button key={t} className={viewTab === t ? 'is-active' : ''} onClick={() => setViewTab(t)}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tab: Contact Info */}
            {viewTab === 'info' && (
              <div className="contacts-overview-grid">
                <section className="contacts-panel contacts-panel--contact">
                  <h4>Contact details</h4>
                  <div className="contacts-info-list">
                    <InfoRow label="Phone" value={vc.phone || '—'} />
                    <InfoRow label="Email" value={vc.email || '—'} />
                    {vc.mobile && <InfoRow label="Mobile" value={vc.mobile} />}
                    {vc.website && <InfoRow label="Website" value={vc.website} />}
                    <InfoRow label="Physical address" value={vc.address || '—'} />
                    {vc.postalAddress && <InfoRow label="Postal address" value={vc.postalAddress} />}
                  </div>
                </section>

                <section className="contacts-panel contacts-panel--identity">
                  <h4>{vc.type === 'company' ? 'Company information' : 'Personal information'}</h4>
                  <dl className="contacts-definition-list">
                    {vc.type === 'company' && <><dt>Trading name</dt><dd>{vc.tradingName || '—'}</dd></>}
                    {vc.vatNumber && <><dt>KRA PIN</dt><dd className="font-mono">{vc.vatNumber}</dd></>}
                    {vc.type === 'company' && <><dt>Registration</dt><dd className="font-mono">{vc.registrationNumber || '—'}</dd></>}
                    {vc.type === 'company' && <><dt>Industry</dt><dd>{vc.industry || '—'}</dd></>}
                    {vc.type === 'individual' && <><dt>ID / Passport</dt><dd className="font-mono">{vc.idNumber || '—'}</dd></>}
                    {vc.type === 'individual' && <><dt>Job title</dt><dd>{vc.jobTitle || '—'}</dd></>}
                    {vc.type === 'individual' && company && (
                      <><dt>Company</dt><dd><button className="contacts-inline-link" onClick={() => { setViewContact(company); setViewTab('info') }}>{company.name}</button></dd></>
                    )}
                    <dt>Location</dt><dd>{[vc.city, vc.country].filter(Boolean).join(', ') || '—'}</dd>
                    <dt>Added</dt><dd>{fmtDate(vc.createdAt)}</dd>
                  </dl>
                </section>

                <section className="contacts-panel contacts-panel--recent">
                  <div className="contacts-panel__heading">
                    <h4>Recent business</h4>
                    <button className="contacts-inline-link" onClick={() => setViewTab('history')}>View all</button>
                  </div>
                  {recentBusiness.length ? (
                    <div className="contacts-recent-list">
                      {recentBusiness.map(item => (
                        <div key={`${item.kind}-${item.ref}`} className="contacts-recent-row">
                          <span>{item.kind}</span>
                          <strong>{item.ref}</strong>
                          <span><Badge status={item.status} size="xs" /></span>
                          <span>{fmtDate(item.date)}</span>
                          <b>{fmtKes(item.amount)}</b>
                        </div>
                      ))}
                    </div>
                  ) : <p className="contacts-empty-copy">No sales or service activity recorded yet.</p>}
                </section>

                {vc.type === 'company' && (
                  <section className="contacts-panel contacts-panel--primary-person">
                    <div className="contacts-panel__heading">
                      <h4>Primary contact</h4>
                      <button className="contacts-inline-link" onClick={() => setViewTab('persons')}>View persons</button>
                    </div>
                    {persons[0] ? (
                      <button className="contacts-primary-person" onClick={() => { setViewContact(persons[0]); setViewTab('info') }}>
                        <span className="contacts-avatar contacts-avatar--sm">{contactInitials(persons[0].name)}</span>
                        <span><strong>{persons[0].name}</strong><small>{persons[0].jobTitle || 'Contact person'}</small></span>
                        <span><small>{persons[0].phone || persons[0].email || 'No contact details'}</small></span>
                      </button>
                    ) : <p className="contacts-empty-copy">No contact persons linked yet.</p>}
                  </section>
                )}

                {vc.notes && (
                  <section className="contacts-panel contacts-panel--note">
                    <h4>Internal note</h4>
                    <p>{vc.notes}</p>
                  </section>
                )}
              </div>
            )}

            {/* Tab: Financial */}
            {viewTab === 'financial' && (
              <div className="contacts-financial-layout">
                <section className="contacts-panel contacts-panel--credit">
                  <h4>Credit & payment</h4>
                  <div className="contacts-credit-summary">
                    <div><span>Available store credit</span><strong className={storeCredit > 0 ? 'is-positive' : ''}>{fmtKes(storeCredit)}</strong></div>
                    <div><span>Payment terms</span><strong>{vc.paymentTermsDays === 0 ? 'Due immediately' : `${vc.paymentTermsDays ?? 0} days`}</strong></div>
                    <div><span>Credit limit</span><strong>{vc.creditLimit ? fmtKes(vc.creditLimit) : '—'}</strong></div>
                    <div><span>Open balance</span><strong>{fmtKes(openBalance)}</strong></div>
                  </div>
                  <p className="contacts-help-copy">Credit can be applied to posted unpaid invoices from Finance.</p>
                </section>

                <section className="contacts-panel contacts-panel--banking">
                  <h4>Banking details</h4>
                  <dl className="contacts-definition-list">
                    <dt>Bank</dt><dd>{vc.bankName || '—'}</dd>
                    <dt>Account</dt><dd className="font-mono">{vc.bankAccount || '—'}</dd>
                    <dt>Branch</dt><dd>{vc.bankBranch || '—'}</dd>
                    {vc.vendorRating && <><dt>Vendor rating</dt><dd>{vc.vendorRating} / 5</dd></>}
                    {vc.isCustomer && <><dt>Loyalty points</dt><dd>{vc.loyaltyPoints || 0}</dd></>}
                  </dl>
                </section>

                <section className="contacts-panel contacts-panel--credits">
                  <h4>Customer credits</h4>
                  {clientCredits.length > 0 ? (
                    <div className="contacts-table-scroll">
                      <table className="contacts-compact-table">
                        <thead><tr><th>Credit</th><th>Source</th><th>Remaining</th><th>Status</th></tr></thead>
                        <tbody>
                          {clientCredits.map(credit => (
                            <tr key={String(credit.id || credit.ref)}>
                              <td className="font-mono">{credit.ref}</td>
                              <td>{customerCreditSourceLabel(credit)}</td>
                              <td className="font-mono">{fmtKes(credit.balance)}</td>
                              <td><Badge status={credit.status === 'available' ? 'active' : credit.status === 'partially_used' ? 'warning' : 'draft'} label={customerCreditStatusLabel(credit.status)} size="xs" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="contacts-empty-copy">No customer credits issued.</p>}
                </section>

                <section className="contacts-panel contacts-panel--invoices">
                  <div className="contacts-panel__heading"><h4>Invoices</h4><button className="contacts-inline-link" onClick={() => setViewTab('history')}>Full history</button></div>
                  {clientInvoices.length ? (
                    <div className="contacts-table-scroll">
                      <table className="contacts-compact-table">
                        <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
                        <tbody>
                          {clientInvoices.slice(0, 5).map(invoice => {
                            const doc = invoiceDocState(invoice.status)
                            const payment = invoicePaymentStatus(invoice)
                            return <tr key={invoice.id}>
                              <td className="font-mono">{displayDocRef(invoice.ref)}</td>
                              <td>{fmtDate(invoice.date)}</td>
                              <td className="font-mono">{fmtKes(invoice.total)}</td>
                              <td className="font-mono">{fmtKes(invoice.amountPaid)}</td>
                              <td className="font-mono">{fmtKes(invoiceResidual(invoice))}</td>
                              <td><Badge status={doc === 'posted' ? payment : doc} label={doc === 'posted' ? PAYMENT_STATUS_LABELS[payment] : undefined} size="xs" /></td>
                            </tr>
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="contacts-empty-copy">No customer invoices recorded.</p>}
                </section>
              </div>
            )}

            {/* Tab: Contact Persons (companies only) */}
            {viewTab === 'persons' && vc.type === 'company' && (
              <section className="contacts-persons-section">
                <div className="contacts-section-heading">
                  <div><h4>Contact persons</h4><p>People linked to {vc.name}</p></div>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setFormDraft(blankIndividualContact({ companyId: vc.id }))
                      setEditId(null)
                      setFormKey(k => k + 1)
                      setShowForm(true)
                      setViewContact(null)
                    }}>
                    <Fa icon={faPlus} /> Add person
                  </button>
                </div>
                {persons.length === 0 ? (
                  <p className="contacts-empty-copy contacts-empty-copy--large">No contact persons linked yet</p>
                ) : persons.map(p => (
                  <div
                    key={p.id}
                    className="contacts-person-row"
                    onClick={() => { setViewContact(p); setViewTab('info') }}
                  >
                    <span className="contacts-avatar contacts-avatar--sm" aria-hidden="true">{contactInitials(p.name)}</span>
                    <div className="contacts-person-row__identity">
                      <p>{p.name}</p>
                      <span>{p.jobTitle || 'Contact person'}</span>
                    </div>
                    <div className="contacts-person-row__channels">
                      <span>{p.phone || 'No phone'}</span>
                      <span>{p.email || 'No email'}</span>
                    </div>
                    <button
                      className="contacts-row-action"
                      onClick={e => { e.stopPropagation(); openEdit(p); setViewContact(null) }}>
                      Edit
                    </button>
                  </div>
                ))}
              </section>
            )}

            {/* Tab: History */}
            {viewTab === 'history' && (
              <div className="contacts-history">

                {/* Revenue summary */}
            <div className="contacts-history__metrics">
                  {[
                    { label: 'Store Credit',  value: fmtKes(storeCredit),           sub: 'ready to apply', color: storeCredit > 0 ? 'var(--success)' : 'var(--text-1)' },
                    { label: 'Total Revenue', value: fmtKes(totalRevenue),         sub: 'invoices paid',  color: 'var(--success)' },
                    { label: 'Open Balance',  value: fmtKes(openBalance),          sub: 'outstanding',    color: openBalance > 0 ? 'var(--danger)' : 'var(--success)' },
                    { label: 'Orders',        value: String(clientSOs.length + clientPOS.length), sub: 'sales & POS', color: 'var(--navy)' },
                  ].map(s => (
                    <div key={s.label} className="contacts-metric contacts-history__metric">
                      <span>{s.label}</span>
                      <strong style={{ color: s.color }}>{s.value}</strong>
                      <small>{s.sub}</small>
                    </div>
                  ))}
                </div>

                {/* Sales Orders */}
                {clientSOs.length > 0 && (
                  <div className="rounded-xl overflow-hidden min-w-0" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1"><Fa icon={faCartShopping} /> Sales Orders</p>
                      <span className="text-[10px] text-t3">{clientSOs.length} orders · {fmtKes(clientSOs.reduce((s, o) => s + o.total, 0))} total</span>
                    </div>
                    <DataTable
                      tableId={`contact-history-so-${vc.id}`}
                      columns={contactSoColumns}
                      rows={clientSOs}
                      rowKey={so => so.id}
                      hideSearch
                      hideColumnFilters
                      hideToolbar
                      perPage={100}
                      emptyMessage="No sales orders"
                    />
                  </div>
                )}

                {/* Repairs */}
                {clientRepairs.length > 0 && (
                  <div className="rounded-xl overflow-hidden min-w-0" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1"><Fa icon={faScrewdriverWrench} /> Repairs</p>
                      <span className="text-[10px] text-t3">{clientRepairs.length} jobs · {fmtKes(repairRevenue)} billed</span>
                    </div>
                    <DataTable
                      tableId={`contact-history-repairs-${vc.id}`}
                      columns={contactRepairColumns}
                      rows={clientRepairs}
                      rowKey={r => r.id}
                      hideSearch
                      hideColumnFilters
                      hideToolbar
                      perPage={100}
                      emptyMessage="No repairs"
                    />
                  </div>
                )}

                {/* Customer Invoices */}
                {clientInvoices.length > 0 && (
                  <div className="rounded-xl overflow-hidden min-w-0" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1"><Fa icon={faFileInvoiceDollar} /> Invoices</p>
                      <span className="text-[10px] text-t3">{clientInvoices.length} invoices · {fmtKes(totalRevenue)} collected</span>
                    </div>
                    <DataTable
                      tableId={`contact-history-invoices-${vc.id}`}
                      columns={contactInvoiceColumns}
                      rows={clientInvoices}
                      rowKey={inv => inv.id}
                      hideSearch
                      hideColumnFilters
                      hideToolbar
                      perPage={100}
                      emptyMessage="No invoices"
                    />
                  </div>
                )}

                {/* POS transactions */}
                {clientPOS.length > 0 && (
                  <div className="rounded-xl overflow-hidden min-w-0" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1"><Fa icon={faCashRegister} /> POS Sales</p>
                      <span className="text-[10px] text-t3">{clientPOS.length} transactions · {fmtKes(clientPOS.reduce((s: number, p) => s + p.total, 0))} total</span>
                    </div>
                    <DataTable
                      tableId={`contact-history-pos-${vc.id}`}
                      columns={contactPosColumns}
                      rows={clientPOS}
                      rowKey={tx => tx.id}
                      hideSearch
                      hideColumnFilters
                      hideToolbar
                      perPage={100}
                      emptyMessage="No POS sales"
                    />
                  </div>
                )}

                                {historyCount === 0 && (
                  <div className="py-10 flex flex-col items-center gap-2">
                    <span className="text-3xl" style={{ color: 'var(--text-4)' }} aria-hidden="true"><Fa icon={faInbox} /></span>
                    <p className="text-xs text-t3">No transactions recorded for this contact yet</p>
                  </div>
                )}
              </div>
            )}

            {viewTab === 'chatter' && (
              <Chatter
                model="contact"
                recordId={vc.id}
                staffName={currentUser?.name || 'Staff'}
                title="Internal Notes & Activities"
              />
            )}

            </div>
          </Modal>
        )
      })()}

      {/* ── Create / Edit Form (shared Contacts form) ─────────────────────────── */}
      {showForm && (
        <ContactFormModal
          key={formKey}
          editId={editId}
          initial={formDraft}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            setViewContact(null)
          }}
        />
      )}

      {/* ── CSV IMPORT MODAL ── */}
      {showImport && (
        <Modal title="Import contacts" subtitle="Review CSV records before they are added" width={920} variant="enterprise"
          onClose={() => { setShowImport(false); setImportRows([]) }}>

          <div className="contacts-import">
          <div className="contacts-import__template">
            <div>
              <p>Download import template</p>
              <span>CSV format · only Name is required</span>
            </div>
            <button className="btn-outline" onClick={downloadTemplate}><Fa icon={faFileArrowDown} /> Download template</button>
          </div>

          {importRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="contacts-import__summary">
                <p>Preview · {importRows.length} row(s)</p>
                <div>
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--success)' }}><Fa icon={faCheck} aria-hidden="true" /> {importRows.filter(r => r.status === 'ok').length} valid</span>
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><Fa icon={faTriangleExclamation} aria-hidden="true" /> {importRows.filter(r => r.status === 'exists').length} skipped</span>
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}><Fa icon={faXmark} aria-hidden="true" /> {importRows.filter(r => r.status === 'error').length} errors</span>
                </div>
              </div>

              <div className="dt-scroll">
              <div className="min-w-[560px] max-w-none flex flex-col">
              <div className="grid text-[10px] font-medium text-t3 uppercase tracking-wider px-3 py-1.5 rounded"
                style={{ gridTemplateColumns: '24px 70px 1.4fr 1.2fr 100px 90px', background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                <span></span><span>Type</span><span>Name</span><span>Email</span><span>Phone</span><span>Status</span>
              </div>

              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {importRows.map((row, i) => (
                  <div key={i} className="grid items-center text-xs px-3 py-2 rounded"
                    style={{
                      gridTemplateColumns: '24px 70px 1.4fr 1.2fr 100px 90px',
                      background: row.status === 'error' ? 'var(--danger-bg)' : row.status === 'exists' ? 'var(--warning-bg)' : 'var(--success-bg)',
                      border: `1px solid ${row.status === 'error' ? '#FECACA' : row.status === 'exists' ? '#FDE68A' : '#BBF7D0'}`,
                    }}>
                    <span>{row.status === 'ok' ? '✓' : row.status === 'exists' ? '⚠' : '✕'}</span>
                    <span className="capitalize">{row.type}</span>
                    <span className="font-medium text-t1 truncate">{row.name || row.raw['Name'] || '—'}</span>
                    <span className="truncate">{row.email || '—'}</span>
                    <span>{row.phone || '—'}</span>
                    <span className="text-[10px]" style={{
                      color: row.status === 'ok' ? 'var(--success)' : row.status === 'exists' ? 'var(--warning)' : 'var(--danger)'
                    }}>{row.message}</span>
                  </div>
                ))}
              </div>
              </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end mt-4 pt-4 border-t" style={{ borderColor: 'var(--bg-muted)' }}>
            <button className="btn-outline" onClick={() => { setShowImport(false); setImportRows([]) }}>Cancel</button>
            <button
              className="btn-primary inline-flex items-center gap-1.5"
              disabled={!importRows.some(r => r.status === 'ok')}
              onClick={handleConfirmImport}>
              <Fa icon={faCheck} aria-hidden="true" /> Import {importRows.filter(r => r.status === 'ok').length} Contact(s)
            </button>
          </div>
          </div>
        </Modal>
      )}
    </ModuleChrome>
  )
}
