'use client'
import { useState } from 'react'
import { useApp, Contact, fmtDate, fmtKes } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Textarea, StatCard, PanelHeader, InfoRow } from '@/components/ui'
import { Fa } from '@/components/icons'
import {
  faUsers, faBuilding, faUser, faCartShopping, faBuildingColumns,
  faPencil, faPlus,
} from '@fortawesome/free-solid-svg-icons'

type FilterTab = 'all' | 'companies' | 'individuals' | 'customers' | 'vendors'
type ViewTab   = 'info' | 'financial' | 'persons' | 'history'

const INDUSTRIES = [
  'Financial Services', 'Telecommunications', 'Electronics', 'IT Services',
  'Healthcare', 'Education', 'Retail', 'Manufacturing', 'Construction',
  'Real Estate', 'Hospitality', 'Transport & Logistics', 'Agriculture',
  'Government', 'NGO / Non-profit', 'Media & Entertainment', 'Other',
]

const blankCompany = (): Omit<Contact, 'id' | 'createdAt'> => ({
  type: 'company', name: '', tradingName: '', registrationNumber: '', vatNumber: '',
  industry: '', email: '', phone: '', mobile: '', website: '',
  address: '', postalAddress: '', city: '', country: 'Kenya',
  isCustomer: true, isVendor: false, tags: [],
  paymentTermsDays: 30, creditLimit: 0,
  bankName: '', bankAccount: '', bankBranch: '',
  notes: '',
})

const blankIndividual = (): Omit<Contact, 'id' | 'createdAt'> => ({
  type: 'individual', name: '', jobTitle: '', idNumber: '', vatNumber: '',
  email: '', phone: '', mobile: '',
  address: '', city: '', country: 'Kenya',
  companyId: undefined,
  isCustomer: true, isVendor: false, tags: [],
  notes: '',
})

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="col-span-2 flex items-center gap-2 mt-1">
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-3)' }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--border-lt)' }} />
    </div>
  )
}

export default function Contacts() {
  const { contacts, addContact, updateContact, deleteContact,
    saleOrders, invoices, repairs, posOrders } = useApp()
  const [tab, setTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [viewContact, setViewContact] = useState<Contact | null>(null)
  const [form, setForm] = useState<any>(blankCompany())
  const [viewTab, setViewTab] = useState<ViewTab>('info')

  const companies = contacts.filter(c => c.type === 'company')

  const filtered = contacts.filter(c => {
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
    setForm(type === 'company' ? blankCompany() : blankIndividual())
    setEditId(null)
    setShowForm(true)
  }
  const openEdit = (c: Contact) => {
    setForm({ ...c })
    setEditId(c.id)
    setShowForm(true)
  }
  const save = () => {
    if (!form.name.trim()) return
    editId ? updateContact(editId, form) : addContact(form)
    setShowForm(false)
    setViewContact(null)
  }
  const f = (k: string) => (v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const total           = contacts.length
  const companiesCount  = contacts.filter(c => c.type === 'company').length
  const individualsCount = contacts.filter(c => c.type === 'individual').length
  const customersCount  = contacts.filter(c => c.isCustomer).length
  const vendorsCount    = contacts.filter(c => c.isVendor).length

  const tabStyle = (t: FilterTab): React.CSSProperties => ({
    background: tab === t ? '#E8F3FA' : 'transparent',
    border: `1px solid ${tab === t ? '#A8D4E8' : 'transparent'}`,
    borderRadius: 8, cursor: 'pointer',
    color: tab === t ? '#1B2762' : 'var(--text-3)',
    padding: '6px 12px', fontSize: 11,
    fontWeight: tab === t ? 600 : 400,
    transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
  })

  const viewTabStyle = (t: ViewTab): React.CSSProperties => ({
    background: viewTab === t ? '#E8F3FA' : 'transparent',
    border: `1px solid ${viewTab === t ? '#A8D4E8' : 'transparent'}`,
    borderRadius: 8, cursor: 'pointer',
    color: viewTab === t ? '#1B2762' : 'var(--text-3)',
    padding: '6px 12px', fontSize: 11,
    fontWeight: viewTab === t ? 600 : 400,
    transition: 'all 0.15s',
  })

  return (
    <div className="flex flex-col gap-4">

      {/* Stats */}
      <div className="kpi-grid">
        <StatCard label="Total Contacts"  value={total}            sub="all records"    color="#8B5CF6" icon={<Fa icon={faUsers} />}          onClick={() => setTab('all')} />
        <StatCard label="Companies"       value={companiesCount}   sub="organisations"  color="#3B82F6" icon={<Fa icon={faBuildingColumns} />} onClick={() => setTab('companies')} />
        <StatCard label="Individuals"     value={individualsCount} sub="persons"        color="#06B6D4" icon={<Fa icon={faUser} />}            onClick={() => setTab('individuals')} />
        <StatCard label="Customers"       value={customersCount}   sub="buy from us"    color="#10B981" icon={<Fa icon={faBuilding} />}        onClick={() => setTab('customers')} />
        <StatCard label="Vendors"         value={vendorsCount}     sub="supply to us"   color="#F59E0B" icon={<Fa icon={faCartShopping} />}    onClick={() => setTab('vendors')} />
      </div>

      {/* Filter bar + action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {(['all', 'companies', 'individuals', 'customers', 'vendors'] as FilterTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(t)} className="capitalize">{t}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="form-input text-[11px] py-1.5"
            style={{ width: 240 }}
            placeholder="Search name, email, phone, KRA PIN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn-outline text-[11px]" onClick={() => openNew('company')}>+ Company</button>
          <button className="btn-primary text-[11px]" onClick={() => openNew('individual')}>+ Individual</button>
        </div>
      </div>

      {/* Contact list */}
      <div className="card overflow-hidden">
        <PanelHeader title="Contacts" count={filtered.length} />

        <div className="overflow-x-auto w-full">
          <div className="min-w-[800px] flex flex-col">
        <div className="table-head" style={{ gridTemplateColumns: '28px 2.2fr 1.3fr 1.1fr 1.1fr 110px 80px' }}>
          <span></span>
          <span>Name</span>
          <span>KRA PIN / ID No.</span>
          <span>Phone</span>
          <span>Email</span>
          <span>Classification</span>
          <span>Actions</span>
        </div>

        {filtered.length === 0
          ? <p className="py-10 text-center text-xs text-t3">No contacts found</p>
          : filtered.map(c => {
            const company = getCompany(c.companyId)
            return (
              <div
                key={c.id}
                className="table-row cursor-pointer"
                style={{ gridTemplateColumns: '28px 2.2fr 1.3fr 1.1fr 1.1fr 110px 80px' }}
                onClick={() => { setViewContact(c); setViewTab('info') }}
              >
                <span style={{ fontSize: 16 }}>{c.type === 'company' ? '🏢' : '👤'}</span>

                <div className="min-w-0">
                  <p className="font-medium text-[12px] truncate text-t1">{c.name}</p>
                  <p className="text-[10px] truncate text-t3">
                    {c.type === 'company' && c.tradingName ? `Trading: ${c.tradingName}` : ''}
                    {c.type === 'individual' && c.jobTitle ? c.jobTitle : ''}
                    {c.type === 'individual' && company
                      ? `${c.jobTitle ? ' · ' : ''}${company.name}`
                      : ''}
                    {c.type === 'individual' && !c.jobTitle && !company ? 'Individual' : ''}
                  </p>
                </div>

                <span className="text-[11px] font-mono text-t3">
                  {c.vatNumber || c.idNumber || '—'}
                </span>
                <span className="text-[11px] text-t2">{c.phone || '—'}</span>
                <span className="text-[11px] text-t2 truncate">{c.email || '—'}</span>

                <div className="flex gap-1 flex-wrap items-center">
                  {c.isCustomer && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#DCFCE7', color: '#059669', border: '1px solid #A7F3D0', whiteSpace: 'nowrap' }}>
                      Customer
                    </span>
                  )}
                  {c.isVendor && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', whiteSpace: 'nowrap' }}>
                      Vendor
                    </span>
                  )}
                </div>

                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <button
                    style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', cursor: 'pointer', color: '#1B2762', fontSize: 10, borderRadius: 6, padding: '2px 8px' }}
                    onClick={() => openEdit(c)}>
                    Edit
                  </button>
                </div>
              </div>
            )
          })
        }
          </div>
        </div>
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
        const openBalance    = clientInvoices.filter(i => i.status === 'posted' || i.status === 'overdue')
                                             .reduce((s, i) => s + (i.total - i.amountPaid), 0)
        const repairRevenue  = clientRepairs.filter(r => r.invoiceId).reduce((s, r) => s + r.total, 0)
        const historyCount   = clientSOs.length + clientRepairs.length + clientPOS.length

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
            <div className="flex items-start gap-4 pb-3" style={{ borderBottom: '1px solid var(--border-lt)' }}>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                {vc.type === 'company' ? '🏢' : '👤'}
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
              <div className="flex gap-2">
                <button className="btn-outline text-[11px]" onClick={() => { openEdit(vc); setViewContact(null) }}>
                  <Fa icon={faPencil} className="mr-1" /> Edit
                </button>
              </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 py-2" style={{ borderBottom: '1px solid var(--border-lt)' }}>
              {([
                ['info',      'Contact Info'],
                ['financial', 'Financial'],
                ...(vc.type === 'company' ? [['persons', `Persons (${persons.length})`]] : []),
                ['history',   `History (${historyCount})`],
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
                          style={{ background: 'none', border: 'none', color: '#1B2762', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 600 }}
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
                    <InfoRow label="Payment Terms" value={vc.paymentTermsDays ? `${vc.paymentTermsDays} days` : '—'} />
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
                      👤
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
                      style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', cursor: 'pointer', color: '#1B2762', fontSize: 10, borderRadius: 6, padding: '2px 8px' }}
                      onClick={e => { e.stopPropagation(); openEdit(p); setViewContact(null) }}>
                      Edit
                    </button>
                  </div>
                ))}
                <button
                  className="flex items-center gap-2 mt-1 text-[11px] cursor-pointer"
                  style={{ background: '#E8F3FA', border: '1px dashed #A8D4E8', borderRadius: 8, padding: '8px 12px', color: '#1B2762' }}
                  onClick={() => {
                    setForm({ ...blankIndividual(), companyId: vc.id })
                    setEditId(null)
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
                    { label: 'Total Revenue', value: fmtKes(totalRevenue),         sub: 'invoices paid',  color: '#10B981' },
                    { label: 'Open Balance',  value: fmtKes(openBalance),          sub: 'outstanding',    color: openBalance > 0 ? '#EF4444' : '#10B981' },
                    { label: 'Orders',        value: String(clientSOs.length + clientPOS.length), sub: 'sales & POS', color: '#8B5CF6' },
                    { label: 'Repairs',       value: String(clientRepairs.length), sub: fmtKes(repairRevenue) + ' billed', color: '#3B82F6' },
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
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1">🛒 Sales Orders</p>
                      <span className="text-[10px] text-t3">{clientSOs.length} orders · {fmtKes(clientSOs.reduce((s, o) => s + o.total, 0))} total</span>
                    </div>
                <div className="overflow-x-auto w-full"><div className="min-w-[600px] flex flex-col">
                    <div className="grid text-[10px] font-medium uppercase tracking-wider px-4 py-2 text-t3" style={{ gridTemplateColumns: '80px 90px 1fr 80px 80px 80px' }}>
                      <span>Ref</span><span>Date</span><span>Items</span><span>Total</span><span>Invoiced</span><span>Status</span>
                    </div>
                    {clientSOs.map(so => (
                      <div key={so.id} className="grid items-center px-4 py-2.5 text-xs" style={{ gridTemplateColumns: '80px 90px 1fr 80px 80px 80px', borderTop: '1px solid var(--border-lt)' }}>
                        <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{so.ref}</span>
                        <span className="text-t3">{fmtDate(so.date)}</span>
                        <span className="text-t2 truncate pr-2">{so.lines.map(l => l.productName).join(', ')}</span>
                        <span className="font-mono text-[11px] text-t1">{fmtKes(so.total)}</span>
                        <span className="text-[10px]" style={{ color: so.invoiceId ? '#10B981' : 'var(--text-3)' }}>{so.invoiceId ? '✓ Yes' : 'No'}</span>
                        <Badge status={so.status} size="xs" />
                      </div>
                    ))}
                </div></div>
                  </div>
                )}

                {/* Repairs */}
                {clientRepairs.length > 0 && (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1">🔧 Repairs</p>
                      <span className="text-[10px] text-t3">{clientRepairs.length} jobs · {fmtKes(repairRevenue)} billed</span>
                    </div>
                    <div className="grid text-[10px] font-medium uppercase tracking-wider px-4 py-2 text-t3" style={{ gridTemplateColumns: '80px 90px 1fr 1fr 80px 80px' }}>
                      <span>Ref</span><span>Date</span><span>Device</span><span>Issue</span><span>Cost</span><span>Status</span>
                    </div>
                    {clientRepairs.map(r => (
                      <div key={r.id} className="grid items-center px-4 py-2.5 text-xs" style={{ gridTemplateColumns: '80px 90px 1fr 1fr 80px 80px', borderTop: '1px solid var(--border-lt)' }}>
                        <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{r.ref}</span>
                        <span className="text-t3">{fmtDate(r.intakeDate)}</span>
                        <div className="min-w-0 pr-2">
                          <p className="truncate text-t1">{r.productName}</p>
                          {r.serialNumber && <p className="text-[9px] font-mono text-t3">{r.serialNumber}</p>}
                        </div>
                        <span className="text-t2 truncate pr-2">{r.issueDescription}</span>
                        <span className="font-mono text-[11px]" style={{ color: r.total > 0 ? '#10B981' : 'var(--text-3)' }}>
                          {r.total > 0 ? fmtKes(r.total) : '—'}
                        </span>
                        <Badge status={r.status} size="xs" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Customer Invoices */}
                {clientInvoices.length > 0 && (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1">🧾 Invoices</p>
                      <span className="text-[10px] text-t3">{clientInvoices.length} invoices · {fmtKes(totalRevenue)} collected</span>
                    </div>
                    <div className="grid text-[10px] font-medium uppercase tracking-wider px-4 py-2 text-t3" style={{ gridTemplateColumns: '80px 90px 80px 80px 80px 80px' }}>
                      <span>Ref</span><span>Date</span><span>Due</span><span>Total</span><span>Paid</span><span>Status</span>
                    </div>
                    {clientInvoices.map(inv => {
                      const outstanding = inv.total - inv.amountPaid
                      return (
                        <div key={inv.id} className="grid items-center px-4 py-2.5 text-xs" style={{ gridTemplateColumns: '80px 90px 80px 80px 80px 80px', borderTop: '1px solid var(--border-lt)' }}>
                          <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{inv.ref}</span>
                          <span className="text-t3">{fmtDate(inv.date)}</span>
                          <span className="text-t3">{fmtDate(inv.dueDate)}</span>
                          <span className="font-mono text-[11px] text-t1">{fmtKes(inv.total)}</span>
                          <span className="font-mono text-[11px]" style={{ color: '#10B981' }}>{fmtKes(inv.amountPaid)}</span>
                          <div className="flex flex-col gap-0.5">
                            <Badge status={inv.status} size="xs" />
                            {outstanding > 0 && inv.status !== 'cancelled' && (
                              <span className="text-[9px] font-mono" style={{ color: '#EF4444' }}>-{fmtKes(outstanding)}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* POS transactions */}
                {clientPOS.length > 0 && (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-lt)' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-lt)' }}>
                      <p className="text-[11px] font-semibold text-t1">🏪 POS Sales</p>
                      <span className="text-[10px] text-t3">{clientPOS.length} transactions · {fmtKes(clientPOS.reduce((s: number, p) => s + p.total, 0))} total</span>
                    </div>
                    <div className="grid text-[10px] font-medium uppercase tracking-wider px-4 py-2 text-t3" style={{ gridTemplateColumns: '80px 100px 1fr 80px 80px' }}>
                      <span>Ref</span><span>Date</span><span>Items</span><span>Total</span><span>Payment</span>
                    </div>
                    {clientPOS.map(tx => (
                      <div key={tx.id} className="grid items-center px-4 py-2.5 text-xs" style={{ gridTemplateColumns: '80px 100px 1fr 80px 80px', borderTop: '1px solid var(--border-lt)' }}>
                        <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{tx.ref}</span>
                        <span className="text-t3">{fmtDate(tx.date)}</span>
                        <span className="text-t2 truncate pr-2">{tx.lines.map((l: { productName: string }) => l.productName).join(', ')}</span>
                        <span className="font-mono text-[11px] text-t1">{fmtKes(tx.total)}</span>
                        <span className="text-[10px] text-t2 capitalize">{tx.payment}</span>
                      </div>
                    ))}
                  </div>
                )}

                {historyCount === 0 && (
                  <div className="py-10 flex flex-col items-center gap-2">
                    <span className="text-3xl">📭</span>
                    <p className="text-xs text-t3">No transactions recorded for this contact yet</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button className="btn-outline text-[11px]" onClick={() => setViewContact(null)}>Close</button>
            </div>
          </Modal>
        )
      })()}

      {/* ── Create / Edit Form ────────────────────────────────────────────────── */}
      {showForm && (
        <Modal
          title={editId ? `Edit — ${form.name || 'Contact'}` : form.type === 'company' ? 'New Company' : 'New Individual'}
          width={680}
          onClose={() => setShowForm(false)}
        >
          {/* Type toggle (only for new) */}
          {!editId && (
            <div className="grid grid-cols-2 gap-2 mb-1">
              {(['company', 'individual'] as const).map(t => (
                <button key={t}
                  onClick={() => setForm(t === 'company' ? blankCompany() : blankIndividual())}
                  className="py-2.5 rounded-lg text-xs font-medium cursor-pointer"
                  style={{
                    background: form.type === t ? '#E8F3FA' : 'var(--bg-surface)',
                    color: form.type === t ? '#1B2762' : 'var(--text-3)',
                    border: form.type === t ? '1px solid #A8D4E8' : '1px solid var(--border-lt)',
                    fontWeight: form.type === t ? 600 : 400,
                  }}>
                  {t === 'company' ? '🏢 Company / Organisation' : '👤 Individual / Person'}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">

            <SectionLabel label="Basic Information" />

            {form.type === 'company' ? (
              <>
                <div className="col-span-2">
                  <Field label="Company Name" required>
                    <Input value={form.name} onChange={f('name')} placeholder="e.g. Acme Corporation Ltd" autoFocus />
                  </Field>
                </div>
                <Field label="Trading Name">
                  <Input value={form.tradingName ?? ''} onChange={f('tradingName')} placeholder="e.g. Acme (if different)" />
                </Field>
                <Field label="Industry">
                  <Select value={form.industry ?? ''} onChange={f('industry')}
                    options={[{ value: '', label: 'Select industry...' }, ...INDUSTRIES.map(i => ({ value: i, label: i }))]} />
                </Field>
                <Field label="Registration Number">
                  <Input value={form.registrationNumber ?? ''} onChange={f('registrationNumber')} placeholder="e.g. CPR/2024/1234" />
                </Field>
                <Field label="KRA PIN">
                  <Input value={form.vatNumber ?? ''} onChange={f('vatNumber')} placeholder="e.g. P051130572W" />
                </Field>
              </>
            ) : (
              <>
                <div className="col-span-2">
                  <Field label="Full Name" required>
                    <Input value={form.name} onChange={f('name')} placeholder="e.g. John Kamau Mwangi" autoFocus />
                  </Field>
                </div>
                <Field label="Job Title">
                  <Input value={form.jobTitle ?? ''} onChange={f('jobTitle')} placeholder="e.g. IT Manager" />
                </Field>
                <Field label="Linked Company">
                  <Select value={form.companyId ?? ''} onChange={f('companyId')}
                    options={[{ value: '', label: 'No company / Independent' }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
                </Field>
                <Field label="National ID / Passport No.">
                  <Input value={form.idNumber ?? ''} onChange={f('idNumber')} placeholder="e.g. 12345678" />
                </Field>
                <Field label="KRA PIN">
                  <Input value={form.vatNumber ?? ''} onChange={f('vatNumber')} placeholder="e.g. A123456789B" />
                </Field>
              </>
            )}

            <SectionLabel label="Contact Details" />

            <Field label="Email"><Input value={form.email} onChange={f('email')} type="email" placeholder="email@example.com" maxLength={100} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={f('phone')} type="tel" placeholder="+254 700 000 000" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" /></Field>
            <Field label="Mobile"><Input value={form.mobile ?? ''} onChange={f('mobile')} type="tel" placeholder="+254 700 000 000" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" /></Field>
            {form.type === 'company' && (
              <Field label="Website"><Input value={form.website ?? ''} onChange={f('website')} placeholder="https://example.com" /></Field>
            )}

            <SectionLabel label="Address" />

            <div className="col-span-2">
              <Field label="Physical Address">
                <Input value={form.address} onChange={f('address')} placeholder="Street / Building, Area" />
              </Field>
            </div>
            {form.type === 'company' && (
              <Field label="Postal Address">
                <Input value={form.postalAddress ?? ''} onChange={f('postalAddress')} placeholder="P.O. Box 00000-00100" />
              </Field>
            )}
            <Field label="City"><Input value={form.city ?? ''} onChange={f('city')} placeholder="e.g. Nairobi" /></Field>
            <Field label="Country"><Input value={form.country ?? ''} onChange={f('country')} placeholder="e.g. Kenya" /></Field>

            <SectionLabel label="Classification" />

            <div className="col-span-2 flex gap-6 py-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={form.isCustomer} onChange={e => f('isCustomer')(e.target.checked)}
                  style={{ accentColor: '#1B2762', width: 14, height: 14 }} />
                <span className="text-t1">Is a Customer</span>
                <span className="text-t3 text-[10px]">(buys from us)</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={form.isVendor} onChange={e => f('isVendor')(e.target.checked)}
                  style={{ accentColor: '#1B2762', width: 14, height: 14 }} />
                <span className="text-t1">Is a Vendor</span>
                <span className="text-t3 text-[10px]">(supplies to us)</span>
              </label>
            </div>

            <SectionLabel label="Financial & Banking" />

            <Field label="Payment Terms (days)">
              <Input value={String(form.paymentTermsDays ?? '')} onChange={v => f('paymentTermsDays')(Number(v) || 0)} placeholder="e.g. 30" />
            </Field>
            <Field label="Credit Limit (KES)">
              <Input value={String(form.creditLimit ?? '')} onChange={v => f('creditLimit')(Number(v) || 0)} placeholder="e.g. 500000" />
            </Field>
            <Field label="Bank Name"><Input value={form.bankName ?? ''} onChange={f('bankName')} placeholder="e.g. Equity Bank" /></Field>
            <Field label="Account Number"><Input value={form.bankAccount ?? ''} onChange={f('bankAccount')} placeholder="e.g. 0110123456" /></Field>
            <div className="col-span-2">
              <Field label="Branch"><Input value={form.bankBranch ?? ''} onChange={f('bankBranch')} placeholder="e.g. Westlands Branch" /></Field>
            </div>

            <SectionLabel label="Notes" />

            <div className="col-span-2">
              <Textarea value={form.notes ?? ''} onChange={f('notes')} placeholder="Any additional notes about this contact..." rows={3} />
            </div>

          </div>

          <div className="flex gap-2 justify-end pt-3">
            <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={!form.name.trim()}>
              {editId ? 'Save Changes' : form.type === 'company' ? 'Create Company' : 'Create Contact'}
            </button>
          </div>
        </Modal>
      )}

    </div>
  )
}