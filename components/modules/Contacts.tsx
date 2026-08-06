'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useCrmStore, Contact, SaleOrder, RepairOrder, Invoice, POSOrder, fmtDate, fmtKes } from '@/lib/store'
import { invoiceDocState, invoicePaymentStatus, isOpenInvoice, invoiceResidual, displayDocRef, PAYMENT_STATUS_LABELS } from '@/lib/odoo-sales-flow'
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
  Fa, faUsers, faBuilding, faUser, faCartShopping, faBuildingColumns,
  faPen, faPlus, faScrewdriverWrench, faFileInvoiceDollar,
  faCashRegister, faInbox, faFileArrowDown, faCheck, faTriangleExclamation, faXmark,
} from '@/components/icons'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'

type FilterTab = 'all' | 'companies' | 'individuals' | 'customers' | 'vendors'
type ViewTab   = 'info' | 'financial' | 'persons' | 'history' | 'chatter'

function contactToFormValues(c: Contact): ContactFormValues {
  const { id: _id, createdAt: _createdAt, ...rest } = c
  return rest
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
  { key: 'date', label: 'Date', priority: 2, width: '100px', render: r => <span className="text-xs text-t3">{fmtDate(r.intakeDate)}</span>, accessor: r => r.intakeDate },
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

  const { contacts, addContact, deleteContact,
    saleOrders, invoices, repairs, posOrders, showToast, users, currentUserId } = useCrmStore()
  const currentUser = users.find(u => u.id === currentUserId)
  const [tab, setTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState<ImportContactRow[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [viewContactId, setViewContactId] = useUrlRecordId()
  const viewContact = viewContactId ? contacts.find(c => c.id === viewContactId) ?? null : null
  const setViewContact = (c: Contact | null) => setViewContactId(c?.id ?? null)
  const [formDraft, setFormDraft] = useState<ContactFormValues>(blankCompanyContact())
  const [formKey, setFormKey] = useState(0)
  const [viewTab, setViewTab] = useState<ViewTab>('info')

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

  const tabStyle = (t: FilterTab): React.CSSProperties => ({
    background: tab === t ? '#E8F3FA' : 'transparent',
    border: `1px solid ${tab === t ? '#A8D4E8' : 'transparent'}`,
    borderRadius: 8, cursor: 'pointer',
    color: tab === t ? 'var(--navy)' : 'var(--text-3)',
    padding: '6px 12px', fontSize: 11,
    fontWeight: tab === t ? 600 : 400,
    transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
  })

  const viewTabStyle = (t: ViewTab): React.CSSProperties => ({
    background: viewTab === t ? '#E8F3FA' : 'transparent',
    border: `1px solid ${viewTab === t ? '#A8D4E8' : 'transparent'}`,
    borderRadius: 8, cursor: 'pointer',
    color: viewTab === t ? 'var(--navy)' : 'var(--text-3)',
    padding: '6px 12px', fontSize: 11,
    fontWeight: viewTab === t ? 600 : 400,
    transition: 'all 0.15s',
  })

  const contactColumns: ColumnDef<Contact>[] = [
    {
      key: 'name', label: 'Name', priority: 1, width: '2.2fr',
      render: c => {
        const company = getCompany(c.companyId)
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ fontSize: 16 }} aria-hidden="true"><Fa icon={c.type === 'company' ? faBuilding : faUser} /></span>
            <div className="min-w-0">
              <p className="font-medium text-[12px] truncate text-t1">{c.name}</p>
              <p className="text-[10px] truncate text-t3">
                {c.type === 'company' && c.tradingName ? `Trading: ${c.tradingName}` : ''}
                {c.type === 'individual' && c.jobTitle ? c.jobTitle : ''}
                {c.type === 'individual' && company ? `${c.jobTitle ? ' · ' : ''}${company.name}` : ''}
                {c.type === 'individual' && !c.jobTitle && !company ? 'Individual' : ''}
              </p>
            </div>
          </div>
        )
      },
      exportValue: c => c.name,
    },
    {
      key: 'classification', label: 'Classification', priority: 1, width: '130px',
      render: c => (
        <div className="flex gap-1 flex-wrap items-center">
          {c.isCustomer && (
            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid #A7F3D0', whiteSpace: 'nowrap' }}>
              Customer
            </span>
          )}
          {c.isVendor && (
            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid #FDE68A', whiteSpace: 'nowrap' }}>
              Vendor
            </span>
          )}
        </div>
      ),
      exportValue: c => [c.isCustomer && 'Customer', c.isVendor && 'Vendor'].filter(Boolean).join(', '),
    },
    {
      key: 'phone', label: 'Phone', priority: 2, width: '110px',
      render: c => <span className="text-[11px] text-t2">{c.phone || '—'}</span>,
      exportValue: c => c.phone,
    },
    {
      key: 'email', label: 'Email', priority: 2, width: '1.1fr',
      render: c => <span className="text-[11px] text-t2 truncate">{c.email || '—'}</span>,
      exportValue: c => c.email,
    },
    {
      key: 'idNumber', label: 'KRA PIN / ID No.', priority: 3, width: '1.3fr',
      render: c => <span className="text-[11px] font-mono text-t3">{c.vatNumber || c.idNumber || '—'}</span>,
      exportValue: c => c.vatNumber || c.idNumber || '',
    },
  ]

  function contactRowActions(c: Contact) {
    return (
      <div className="flex items-center gap-1">
        <button
          style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', cursor: 'pointer', color: 'var(--navy)', fontSize: 10, borderRadius: 6, padding: '2px 8px' }}
          onClick={e => { e.stopPropagation(); openEdit(c) }}>
          Edit
        </button>
        {c.isArchived ? (
          <button
            style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', cursor: 'pointer', color: '#065F46', fontSize: 10, borderRadius: 6, padding: '2px 8px' }}
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
            style={{ background: '#FEF3C7', border: '1px solid #FDE68A', cursor: 'pointer', color: '#92400E', fontSize: 10, borderRadius: 6, padding: '2px 8px' }}
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
    return (
      <div key={c.id} className="p-4 bg-white hover:bg-gray-50 cursor-pointer transition-colors rounded-xl border border-gray-100" onClick={() => { setViewContact(c); setViewTab('info') }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
              <Fa icon={c.type === 'company' ? faBuilding : faUser} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-[13px] text-gray-900 truncate">{c.name}</p>
              <p className="text-[11px] text-gray-500 truncate mt-0.5">
                {c.type === 'company' && c.tradingName ? `Trading: ${c.tradingName}` : ''}
                {c.type === 'individual' && c.jobTitle ? c.jobTitle : ''}
                {c.type === 'individual' && company ? `${c.jobTitle ? ' · ' : ''}${company.name}` : ''}
                {c.type === 'individual' && !c.jobTitle && !company ? 'Individual' : ''}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-3">
          {c.isCustomer && <span className="text-[9px] px-2 py-0.5 rounded bg-green-50 text-green-600 border border-green-100 font-semibold">Customer</span>}
          {c.isVendor && <span className="text-[9px] px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100 font-semibold">Vendor</span>}
          <span className="text-[10px] font-mono text-gray-400 ml-auto">{c.vatNumber || c.idNumber || '—'}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-3 bg-gray-50 p-2 rounded-lg border border-gray-100">
          <span className="truncate flex-1" style={{ color: c.email ? 'var(--text-1)' : 'var(--text-4)' }}>{c.email || 'No email'}</span>
          <span className="flex-shrink-0 font-mono" style={{ color: c.phone ? 'var(--text-1)' : 'var(--text-4)' }}>{c.phone || 'No phone'}</span>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 text-[11px] font-medium py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-navy-500 border border-blue-100 cursor-pointer transition-colors" onClick={e => { e.stopPropagation(); openEdit(c) }}>Edit</button>
        </div>
      </div>
    )
  }

  if (!mounted) return <ModuleSkeleton />

  return (
    <ModuleChrome
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
        { id: 'all', label: 'All' },
        { id: 'companies', label: 'Companies' },
        { id: 'individuals', label: 'Individuals' },
        { id: 'customers', label: 'Customers' },
        { id: 'vendors', label: 'Vendors' },
      ]}
      activeTab={tab}
      onTabChange={id => setTab(id as FilterTab)}
      maxVisibleDesktop={5}
      tabAriaLabel="Contact filters"
    >
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }} />
      <PageToolbar
        search={
          <div className="flex flex-wrap items-center gap-2 w-full">
            <input
              aria-label="Search contacts by name, email, or phone"
              className="form-input text-[11px] py-1.5 w-full min-w-[12rem] sm:w-64"
              placeholder="Search name, email, phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-3)] whitespace-nowrap">
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
      <div className="card overflow-hidden m-3 sm:m-4">
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
        const historyCount   = clientSOs.length + clientRepairs.length + clientPOS.length + clientInvoices.length

        return (
          <Modal
            title={vc.name}
            subtitle={
              vc.type === 'company'
                ? (vc.tradingName ? `${vc.tradingName} · ` : '') + (vc.industry || 'Company')
                : vc.jobTitle
                  ? `${vc.jobTitle}${company ? ` · ${company.name}` : ''}`
                  : company ? company.name : 'Individual'
            }
            width={820}
            onClose={() => setViewContact(null)}
          >
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-4 pb-3" style={{ borderBottom: '1px solid var(--border-lt)' }}>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                <Fa icon={vc.type === 'company' ? faBuilding : faUser} />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-t1">{vc.name}</h3>
                {vc.tradingName && <p className="text-[11px] text-t3 mb-1">Trading as: {vc.tradingName}</p>}
                <div className="flex gap-1.5 flex-wrap mt-1">
                  <Badge status={vc.type} />
                  {vc.isCustomer && <span className="badge badge-green">Customer</span>}
                  {vc.isVendor && <span className="badge badge-amber">Vendor</span>}
                  {vc.tags.map(t => <span key={t} className="badge badge-purple">{t}</span>)}
                </div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button className="btn-outline text-[11px] flex-1 sm:flex-none justify-center" onClick={() => { openEdit(vc); setViewContact(null) }}>
                  <Fa icon={faPen} className="mr-1" /> Edit
                </button>
              </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 py-2 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid var(--border-lt)' }}>
              {([
                ['info',      'Contact Info'],
                ['financial', 'Financial'],
                ...(vc.type === 'company' ? [['persons', `Persons (${persons.length})`]] : []),
                ['history',   `History (${historyCount})`],
                ['chatter',   'Notes'],
              ] as [ViewTab, string][]).map(([t, label]) => (
                <button key={t} onClick={() => setViewTab(t)} style={viewTabStyle(t)}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tab: Contact Info */}
            {viewTab === 'info' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 text-t3">Contact Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <InfoRow label="Email" value={vc.email || '—'} />
                    <InfoRow label="Phone" value={vc.phone || '—'} />
                    {vc.mobile && <InfoRow label="Mobile" value={vc.mobile} />}
                    {vc.website && <InfoRow label="Website" value={vc.website} />}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 text-t3">Address</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <InfoRow label="Physical Address" value={vc.address || '—'} />
                    {vc.postalAddress && <InfoRow label="Postal Address" value={vc.postalAddress} />}
                    {vc.city && <InfoRow label="City" value={vc.city} />}
                    {vc.country && <InfoRow label="Country" value={vc.country} />}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 text-t3">
                    {vc.type === 'company' ? 'Business Identity' : 'Personal Identity'}
                  </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {vc.vatNumber && <InfoRow label="KRA PIN" value={vc.vatNumber} mono />}
                    {vc.type === 'company' && vc.registrationNumber && <InfoRow label="Registration No." value={vc.registrationNumber} mono />}
                    {vc.type === 'company' && vc.industry && <InfoRow label="Industry" value={vc.industry} />}
                    {vc.type === 'individual' && vc.idNumber && <InfoRow label="National ID / Passport" value={vc.idNumber} mono />}
                    {vc.type === 'individual' && vc.jobTitle && <InfoRow label="Job Title" value={vc.jobTitle} />}
                    {vc.type === 'individual' && company && (
                      <InfoRow label="Company" value={
                        <button
                          style={{ background: 'none', border: 'none', color: 'var(--navy)', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 600 }}
                          onClick={() => { setViewContact(company); setViewTab('info') }}>
                          {company.name}
                        </button>
                      } />
                    )}
                    <InfoRow label="Added" value={fmtDate(vc.createdAt)} />
                  </div>
                </div>

                {vc.notes && (
                  <div className="rounded-lg p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                    <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-t3">Notes</p>
                    <p className="text-[12px] text-t2 leading-relaxed">{vc.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Financial */}
            {viewTab === 'financial' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 text-t3">Payment Terms</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <InfoRow
                      label="Payment Terms"
                      value={
                        vc.paymentTermsDays === 0
                          ? 'Cash / due immediately (0 days)'
                          : vc.paymentTermsDays != null
                            ? `${vc.paymentTermsDays} days`
                            : '—'
                      }
                    />
                    <InfoRow label="Credit Limit" value={vc.creditLimit ? `KES ${vc.creditLimit.toLocaleString()}` : '—'} />
                    {vc.vendorRating && <InfoRow label="Vendor Rating" value={`${vc.vendorRating} / 5`} />}
              {vc.isCustomer && <InfoRow label="Loyalty Points" value={String(vc.loyaltyPoints || 0)} />}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 text-t3">Banking Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <InfoRow label="Bank Name" value={vc.bankName || '—'} />
                    <InfoRow label="Account Number" value={vc.bankAccount || '—'} mono />
                    <InfoRow label="Branch" value={vc.bankBranch || '—'} />
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Contact Persons (companies only) */}
            {viewTab === 'persons' && vc.type === 'company' && (
              <div className="flex flex-col gap-2">
                {persons.length === 0 ? (
                  <p className="text-[12px] text-t3 text-center py-6">No contact persons linked yet</p>
                ) : persons.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                    onClick={() => { setViewContact(p); setViewTab('info') }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                      style={{ background: '#E8F3FA' }}>
                      <Fa icon={faUser} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate text-t1">{p.name}</p>
                      <p className="text-[10px] text-t3">{p.jobTitle || 'Contact Person'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-t2">{p.phone || '—'}</p>
                      <p className="text-[10px] text-t3 truncate">{p.email || '—'}</p>
                    </div>
                    <button
                      className="ml-2"
                      style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', cursor: 'pointer', color: 'var(--navy)', fontSize: 10, borderRadius: 6, padding: '2px 8px' }}
                      onClick={e => { e.stopPropagation(); openEdit(p); setViewContact(null) }}>
                      Edit
                    </button>
                  </div>
                ))}
                <button
                  className="flex items-center gap-2 mt-1 text-[11px] cursor-pointer"
                  style={{ background: '#E8F3FA', border: '1px dashed #A8D4E8', borderRadius: 8, padding: '8px 12px', color: 'var(--navy)' }}
                  onClick={() => {
                    setFormDraft(blankIndividualContact({ companyId: vc.id }))
                    setEditId(null)
                    setFormKey(k => k + 1)
                    setShowForm(true)
                    setViewContact(null)
                  }}>
                  <Fa icon={faPlus} /> Add contact person
                </button>
              </div>
            )}

            {/* Tab: History */}
            {viewTab === 'history' && (
              <div className="flex flex-col gap-3">

                {/* Revenue summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Total Revenue', value: fmtKes(totalRevenue),         sub: 'invoices paid',  color: 'var(--success)' },
                    { label: 'Open Balance',  value: fmtKes(openBalance),          sub: 'outstanding',    color: openBalance > 0 ? 'var(--danger)' : 'var(--success)' },
                    { label: 'Orders',        value: String(clientSOs.length + clientPOS.length), sub: 'sales & POS', color: 'var(--navy)' },
                    { label: 'Repairs',       value: String(clientRepairs.length), sub: fmtKes(repairRevenue) + ' billed', color: 'var(--primary)' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                      <p className="text-[10px] uppercase tracking-wider mb-1 text-t3">{s.label}</p>
                      <p className="text-base font-bold" style={{ color: s.color }}>{s.value}</p>
                      <p className="text-[10px] mt-0.5 text-t3">{s.sub}</p>
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

            <div className="flex justify-end pt-1">
              <button className="btn-outline text-[11px]" onClick={() => setViewContact(null)}>Close</button>
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
        <Modal title="Import Contacts from CSV" subtitle="Preview and confirm import" width={780}
          onClose={() => { setShowImport(false); setImportRows([]) }}>
          
          <div className="flex items-center justify-between px-4 py-3 rounded-lg mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
            <div>
              <p className="text-xs font-semibold text-t1">Download Import Template</p>
              <p className="text-[10px] text-t3 mt-0.5">CSV format. Required columns: Name</p>
            </div>
            <button className="btn-secondary text-[11px]" onClick={downloadTemplate}><Fa icon={faFileArrowDown} /> Download Template</button>
          </div>

          {importRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-t1">Preview — {importRows.length} row(s)</p>
                <div className="flex gap-3 text-[10px]">
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
        </Modal>
      )}
    </ModuleChrome>
  )
}