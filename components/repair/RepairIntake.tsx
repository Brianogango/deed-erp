// @ts-nocheck
'use client'

import { useState, useMemo } from 'react'
import { useApp, RepairOrder, fmtDate } from '@/lib/store'
import { Field, Input, Select, Textarea, Badge } from '@/components/ui'
import { Fa } from '@/components/icons'
import {
  faArrowLeft, faSave, faUser, faMicrochip, faClipboardList,
  faShieldAlt, faCheckCircle, faExclamationTriangle, faSignature,
  faCopy, faExternalLinkAlt, faBuilding, faPlusCircle, faChevronDown,
} from '@fortawesome/free-solid-svg-icons'

const CYAN  = '#00AEEF'
const NAVY  = '#1A1F5E'

const DEVICE_TYPES = [
  { id: 'laptop',  label: 'Laptop',  icon: '💻' },
  { id: 'desktop', label: 'Desktop', icon: '🖥️' },
  { id: 'phone',   label: 'Phone',   icon: '📱' },
  { id: 'printer', label: 'Printer', icon: '🖨️' },
  { id: 'other',   label: 'Other',   icon: '🔧' },
]

export default function RepairIntake({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: (id: string) => void }) {
  const {
    repairs, contacts, contactPersons, warranties,
    createRepair, updateRepair, addContact, createContactPerson, showToast,
  } = useApp()

  const customers   = useMemo(() => contacts.filter(c => c.isCustomer), [contacts])
  const individuals = useMemo(() => customers.filter(c => c.type === 'individual'), [customers])
  const companies   = useMemo(() => customers.filter(c => c.type === 'company'),    [customers])

  // ── Client type ────────────────────────────────────────────────────────────
  const [clientType, setClientType] = useState<'individual' | 'company'>('individual')

  // ── Individual fields ──────────────────────────────────────────────────────
  const [indv, setIndv] = useState({ name: '', phone: '', email: '', id: '' })
  const setI = (k: keyof typeof indv, v: string) => setIndv(p => ({ ...p, [k]: v }))

  // ── Company fields ─────────────────────────────────────────────────────────
  const [companySearch, setCompanySearch] = useState('')
  const [selectedCompany, setSelectedCompany] = useState<(typeof companies)[0] | null>(null)
  const [showNewCompanyForm, setShowNewCompanyForm] = useState(false)
  const [newCompany, setNewCompany] = useState({ name: '', phone: '', email: '', address: '' })
  const setNC = (k: keyof typeof newCompany, v: string) => setNewCompany(p => ({ ...p, [k]: v }))

  // ── Contact person fields ──────────────────────────────────────────────────
  const [selectedPersonId, setSelectedPersonId] = useState('')
  const [showNewPersonForm, setShowNewPersonForm] = useState(false)
  const [newPerson, setNewPerson] = useState({ firstName: '', lastName: '', phone: '', email: '', jobTitle: '' })
  const setNP = (k: keyof typeof newPerson, v: string) => setNewPerson(p => ({ ...p, [k]: v }))

  // ── Device & job fields ────────────────────────────────────────────────────
  const [device, setDevice] = useState({
    deviceType: 'laptop', customDeviceType: '',
    brand: '', model: '', serial: '',
    deviceCondition: 'good' as 'good' | 'fair' | 'poor' | 'damaged',
    accessoriesChecked: new Set<string>(), accessoriesOther: '', issueDesc: '', clientLaptopPassword: '',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    intakeChannel: 'walk_in' as 'walk_in' | 'website' | 'whatsapp' | 'call' | 'email' | 'rider_pickup',
    repairPath: 'diagnosis_first' as 'diagnosis_first' | 'direct_repair',
    estimatedCompletion: '',
    consentSignature: '', agreeTerms: false,
    serialWarrantyException: false,
    serialWarrantyExceptionReason: '' as '' | 'device_cannot_power_on' | 'label_unreadable' | 'sticker_missing' | 'customer_unable_to_confirm' | 'other',
    serialWarrantyExceptionNotes: '',
    clientCausedDamage: false, clientDamageReason: '',
  })
  const setD = (k: keyof typeof device, v: string | boolean) => setDevice(p => ({ ...p, [k]: v }))

  const [loading, setLoading] = useState(false)
  const [successData, setSuccessData] = useState<{ id: string; ref: string } | null>(null)

  // ── Derived lookups ────────────────────────────────────────────────────────
  const companyPersons = useMemo(
    () => selectedCompany
      ? contactPersons.filter(p =>
          p.companyId === selectedCompany.id || p.clientId === selectedCompany.id
        )
      : [],
    [contactPersons, selectedCompany],
  )

  const selectedPerson = useMemo(
    () => companyPersons.find(p => p.id === selectedPersonId) ?? null,
    [companyPersons, selectedPersonId],
  )

  const filteredCompanies = useMemo(() => {
    const q = companySearch.toLowerCase()
    return q.length < 1 ? companies : companies.filter(c => c.name.toLowerCase().includes(q))
  }, [companies, companySearch])

  // ── Warranty + duplicate via serial ───────────────────────────────────────
  const matchedWarranty = device.serial.trim().length >= 4
    ? warranties.find(w =>
        w.serialNumber.toLowerCase() === device.serial.trim().toLowerCase() &&
        w.status === 'active'
      )
    : undefined

  const duplicateRepair = device.serial.trim().length >= 4
    ? repairs.find(r =>
        r.serialNumber?.toLowerCase() === device.serial.trim().toLowerCase() &&
        !['delivered', 'closed', 'cancelled', 'returned'].includes(r.status)
      )
    : undefined

  const intakeUnderWarranty = !!matchedWarranty && !device.clientCausedDamage && !device.serialWarrantyException
  const warrantyVerificationStatus = device.serialWarrantyException
    ? 'pending_manual_review'
    : device.clientCausedDamage
      ? 'excluded_client_damage'
      : matchedWarranty
        ? 'verified'
        : 'not_checked'

  // ── Phone lookup for individual ────────────────────────────────────────────
  const handleIndvPhoneChange = (phone: string) => {
    setI('phone', phone)
    if (phone.replace(/\D/g, '').length >= 9) {
      const match = individuals.find(c =>
        (c.phone ?? '').replace(/\D/g, '') === phone.replace(/\D/g, '') ||
        (c.mobile ?? '').replace(/\D/g, '') === phone.replace(/\D/g, '')
      )
      if (match) {
        setI('id', match.id)
        setI('name', match.name)
        setI('email', match.email ?? '')
      }
    }
  }

  const handleIndvNameChange = (name: string) => {
    setI('name', name)
    const match = individuals.find(c => c.name.toLowerCase().startsWith(name.toLowerCase()))
    if (match) {
      setI('id', match.id)
      setI('phone', match.phone ?? '')
      setI('email', match.email ?? '')
    } else {
      setI('id', '')
    }
  }

  // Prior repairs count for returning client display
  const priorIndvRepairs = useMemo(() =>
    indv.id ? repairs.filter(r => r.customerId === indv.id).length : 0,
    [repairs, indv.id],
  )

  const priorCompanyRepairs = useMemo(() =>
    selectedCompany ? repairs.filter(r => r.customerId === selectedCompany.id).length : 0,
    [repairs, selectedCompany],
  )

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleCreateIntake = async () => {
    // Validate client fields
    if (clientType === 'individual') {
      if (!indv.name.trim() || !indv.phone.trim()) {
        showToast('Customer name and phone are required', 'error'); return
      }
    } else {
      if (!selectedCompany && !newCompany.name.trim()) {
        showToast('Select or create a company', 'error'); return
      }
      if (!selectedPersonId && !showNewPersonForm) {
        showToast('Select or add a contact person', 'error'); return
      }
      if (showNewPersonForm && (!newPerson.firstName.trim() || !newPerson.phone.trim())) {
        showToast('Contact person first name and phone are required', 'error'); return
      }
    }

    if (!device.brand || !device.model) {
      showToast('Device brand and model are required', 'error'); return
    }
    if (duplicateRepair) {
      showToast(`Device already in repair: ${duplicateRepair.ref}`, 'error'); return
    }
    if (device.serialWarrantyException && !device.serialWarrantyExceptionReason) {
      showToast('Select why the serial/warranty information cannot be verified', 'error'); return
    }
    if (device.repairPath === 'direct_repair' && (!device.consentSignature.trim() || !device.agreeTerms)) {
      showToast('Customer signature and terms agreement required for direct repair', 'error'); return
    }

    setLoading(true)
    try {
      let customerId  = ''
      let customerName = ''
      let customerPhone = ''
      let customerEmail = ''
      let cpId    = ''
      let cpName  = ''
      let cpPhone = ''
      let cpEmail = ''
      let cpTitle = ''

      if (clientType === 'individual') {
        // Resolve or create individual contact
        if (indv.id) {
          customerId    = indv.id
          customerName  = indv.name
          customerPhone = indv.phone
          customerEmail = indv.email
        } else {
          const contact = await addContact({
            type: 'individual',
            name: indv.name.trim(),
            phone: indv.phone.trim(),
            email: indv.email.trim(),
            address: '',
            isCustomer: true,
            isVendor: false,
            tags: ['repair-client'],
          })
          customerId    = contact.id
          customerName  = contact.name
          customerPhone = contact.phone
          customerEmail = contact.email ?? ''
        }
      } else {
        // Resolve or create company contact
        let company = selectedCompany
        if (!company) {
          company = await addContact({
            type: 'company',
            name: newCompany.name.trim(),
            phone: newCompany.phone.trim(),
            email: newCompany.email.trim(),
            address: newCompany.address.trim(),
            isCustomer: true,
            isVendor: false,
            tags: ['repair-client'],
          })
        }
        customerId   = company.id
        customerName = company.name

        // Resolve or create contact person
        let person = selectedPerson
        if (!person) {
          person = createContactPerson({
            clientId: company.id,
            companyId: company.id,
            companyName: company.name,
            firstName: newPerson.firstName.trim(),
            lastName: newPerson.lastName.trim(),
            phone: newPerson.phone.trim(),
            email: newPerson.email.trim(),
            jobTitle: newPerson.jobTitle.trim(),
            isPrimary: companyPersons.length === 0,
          })
        }
        cpId    = person.id
        cpName  = `${person.firstName} ${person.lastName}`.trim()
        cpPhone = person.phone ?? ''
        cpEmail = person.email ?? ''
        cpTitle = person.jobTitle ?? ''

        // SMS and notifications go to the contact person
        customerPhone = cpPhone || company.phone
        customerEmail = cpEmail || (company.email ?? '')
      }

      const deviceTypeLabel = device.deviceType === 'other'
        ? device.customDeviceType || 'Other'
        : device.deviceType
      const productLabel = `${device.brand} ${device.model}`.trim()

      const rep = createRepair(customerId, customerName, productLabel, device.serial, device.issueDesc)

      const checkedItems = Array.from(device.accessoriesChecked)
      const otherItems = device.accessoriesOther.split(',').map(n => n.trim()).filter(Boolean)
      const accessories = [...checkedItems, ...otherItems].map(name => ({ name, received: true }))

      updateRepair(rep.id, {
        status: 'received',
        customerPhone,
        customerEmail,
        contactPersonId: cpId || undefined,
        contactPersonName: cpName || undefined,
        contactPersonPhone: cpPhone || undefined,
        contactPersonEmail: cpEmail || undefined,
        contactPersonTitle: cpTitle || undefined,
        intakeChannel: device.intakeChannel,
        deviceCondition: device.deviceCondition,
        clientLaptopPassword: device.clientLaptopPassword.trim() || undefined,
        priority: device.priority,
        repairPath: device.repairPath,
        estimatedCompletionDate: device.estimatedCompletion || undefined,
        accessories,
        underWarranty: intakeUnderWarranty,
        warrantyId: intakeUnderWarranty ? matchedWarranty?.id : undefined,
        warrantyVerificationStatus,
        serialWarrantyException: device.serialWarrantyException || undefined,
        serialWarrantyExceptionReason: device.serialWarrantyException ? device.serialWarrantyExceptionReason || undefined : undefined,
        serialWarrantyExceptionNotes: device.serialWarrantyException ? device.serialWarrantyExceptionNotes || undefined : undefined,
        clientCausedDamage: device.clientCausedDamage || undefined,
        clientDamageReason: device.clientCausedDamage ? device.clientDamageReason || undefined : undefined,
        notes: device.repairPath === 'direct_repair'
          ? `[Direct Repair Consent] Signed by: ${device.consentSignature}. Liability Waiver Accepted: YES. Device type: ${deviceTypeLabel}.\nTerms Agreed: Customer agrees to bypass the diagnosis phase.`
          : `Device type: ${deviceTypeLabel}.`,
      })

      showToast(`Ticket ${rep.ref} created`, 'success')
      setSuccessData({ id: rep.id, ref: rep.ref })
    } catch (err) {
      showToast('Failed to create repair job', 'error')
    } finally {
      setLoading(false)
    }
  }

  const portalUrl = successData ? `https://erp.deed.co.ke/portal/repair/${successData.ref}` : ''

  // ── Success screen ─────────────────────────────────────────────────────────
  if (successData) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center animate-in zoom-in-95 duration-500" style={{ background: 'var(--bg-page)' }}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-xl" style={{ background: '#DCFCE7', color: '#059669' }}>
          <Fa icon={faCheckCircle} className="text-4xl" />
        </div>
        <h2 className="text-2xl font-black tracking-tight mb-2" style={{ color: NAVY }}>Repair Job Booked!</h2>
        <p className="text-sm font-medium mb-8 max-w-sm" style={{ color: 'var(--text-3)' }}>
          Ticket <span className="font-bold" style={{ color: CYAN }}>{successData.ref}</span> has been created. Share the tracking link below.
        </p>
        <div className="w-full max-w-md rounded-2xl p-5 mb-8 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Client Portal Link</p>
          <div className="rounded-xl p-3 text-xs font-mono break-all mb-4" style={{ background: 'var(--bg-surface)', color: CYAN }}>
            {portalUrl}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { navigator.clipboard.writeText(portalUrl); showToast('Copied!', 'success') }}
              className="btn-outline flex items-center justify-center gap-2 py-3"
            >
              <Fa icon={faCopy} /> Copy Link
            </button>
            <a href={portalUrl} target="_blank" className="btn-primary flex items-center justify-center gap-2 py-3">
              <Fa icon={faExternalLinkAlt} /> Open Portal
            </a>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <button onClick={() => onSuccess(successData.id)} className="btn-primary px-8 py-3">
            View Job Details
          </button>
          <button
            onClick={() => {
              setSuccessData(null)
              setDevice(p => ({ ...p, brand: '', model: '', serial: '', issueDesc: '', accessoriesChecked: new Set<string>(), accessoriesOther: '', clientLaptopPassword: '' }))
            }}
            className="btn-outline px-8 py-3"
          >
            Book Another
          </button>
        </div>
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full animate-in fade-in duration-300" style={{ background: 'var(--bg-page)' }}>
      {/* Header */}
      <div className="border-b px-4 py-3 sm:px-6 sticky top-0 z-10 shadow-sm flex-shrink-0" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button onClick={onCancel} className="p-2 rounded-xl transition-all active:scale-90" style={{ color: 'var(--text-3)' }}>
              <Fa icon={faArrowLeft} />
            </button>
            <div>
              <h1 className="text-base font-bold tracking-tight" style={{ color: NAVY }}>New Repair Intake</h1>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Register device for service</p>
            </div>
          </div>
          <button
            className="btn-primary flex items-center gap-2 shadow-md"
            onClick={handleCreateIntake}
            disabled={loading}
            style={loading ? { opacity: 0.5 } : {}}
          >
            <Fa icon={faSave} />
            <span>{loading ? 'Booking...' : 'Book Repair Job'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Main Column ─────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* 1. Client Type Toggle */}
            <section className="card p-5">
              <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
                Client Type
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(['individual', 'company'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setClientType(t)}
                    className="py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
                    style={clientType === t
                      ? { background: NAVY, color: '#fff', boxShadow: '0 4px 12px rgba(26,31,94,0.2)' }
                      : { background: 'var(--bg-surface)', color: 'var(--text-3)', border: '1px solid var(--border)' }
                    }
                  >
                    <Fa icon={t === 'individual' ? faUser : faBuilding} />
                    {t === 'individual' ? 'Individual' : 'Company'}
                  </button>
                ))}
              </div>
            </section>

            {/* 2a. Individual Client */}
            {clientType === 'individual' && (
              <section className="card p-6" style={{ borderLeft: `4px solid ${CYAN}` }}>
                <div className="flex items-center gap-2 mb-5">
                  <div className="p-1.5 rounded-lg" style={{ background: '#E0F6FE', color: CYAN }}>
                    <Fa icon={faUser} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>Customer Information</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Phone Number" required hint="Searched first — fills name if returning client">
                    <Input
                      value={indv.phone}
                      onChange={handleIndvPhoneChange}
                      placeholder="+254 7XX XXX XXX"
                    />
                  </Field>
                  <Field label="Customer Name" required>
                    <div className="relative">
                      <input
                        className="form-input font-medium"
                        value={indv.name}
                        onChange={e => handleIndvNameChange(e.target.value)}
                        placeholder="Full name..."
                        list="individual-list"
                      />
                      <datalist id="individual-list">
                        {individuals.map(c => <option key={c.id} value={c.name} />)}
                      </datalist>
                    </div>
                  </Field>
                  <Field label="Email Address">
                    <Input value={indv.email} onChange={v => setI('email', v)} placeholder="customer@email.com" type="email" />
                  </Field>
                </div>

                {/* Returning client banner */}
                {indv.id && priorIndvRepairs > 0 && (
                  <div className="mt-4 flex items-center gap-3 p-3 rounded-xl text-xs font-semibold animate-in fade-in duration-200" style={{ background: '#E0F6FE', color: NAVY }}>
                    <span style={{ fontSize: 18 }}>🔁</span>
                    <div>
                      <span className="font-black">Returning client</span>
                      <span className="ml-2 font-medium" style={{ color: 'var(--text-3)' }}>
                        {priorIndvRepairs} prior repair{priorIndvRepairs !== 1 ? 's' : ''} on record
                      </span>
                    </div>
                  </div>
                )}
                {indv.id && priorIndvRepairs === 0 && (
                  <div className="mt-4 flex items-center gap-2 p-3 rounded-xl text-xs" style={{ background: '#F0FDF4', color: '#166534' }}>
                    <span>✓</span>
                    <span>Existing contact found</span>
                  </div>
                )}
              </section>
            )}

            {/* 2b. Company Client */}
            {clientType === 'company' && (
              <section className="card p-6" style={{ borderLeft: `4px solid ${NAVY}` }}>
                <div className="flex items-center gap-2 mb-5">
                  <div className="p-1.5 rounded-lg" style={{ background: '#ECEDF8', color: NAVY }}>
                    <Fa icon={faBuilding} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>Company</h3>
                </div>

                {/* Company search / select */}
                {!selectedCompany && !showNewCompanyForm && (
                  <>
                    <Field label="Search Company" hint="Type to filter existing companies">
                      <div className="relative">
                        <input
                          className="form-input"
                          value={companySearch}
                          onChange={e => setCompanySearch(e.target.value)}
                          placeholder="Company name..."
                        />
                      </div>
                    </Field>
                    {companySearch.length > 0 && (
                      <div className="mt-2 rounded-xl border divide-y overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                        {filteredCompanies.slice(0, 6).map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setSelectedCompany(c); setCompanySearch(''); setSelectedPersonId(''); setShowNewPersonForm(false) }}
                            className="w-full text-left px-4 py-3 text-xs hover:bg-[var(--bg-surface)] transition-colors"
                          >
                            <div className="font-bold" style={{ color: NAVY }}>{c.name}</div>
                            <div style={{ color: 'var(--text-3)' }}>{c.phone}</div>
                          </button>
                        ))}
                        {filteredCompanies.length === 0 && (
                          <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>No match — create new below</div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowNewCompanyForm(true)}
                      className="mt-3 text-xs font-bold flex items-center gap-1.5"
                      style={{ color: CYAN }}
                    >
                      <Fa icon={faPlusCircle} /> Create new company
                    </button>
                  </>
                )}

                {/* New company mini-form */}
                {showNewCompanyForm && !selectedCompany && (
                  <div className="space-y-3 p-4 rounded-xl animate-in slide-in-from-top-2 duration-200" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: NAVY }}>New Company</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Company Name" required>
                        <Input value={newCompany.name} onChange={v => setNC('name', v)} placeholder="Safaricom PLC" />
                      </Field>
                      <Field label="Phone" required>
                        <Input value={newCompany.phone} onChange={v => setNC('phone', v)} placeholder="+254 7XX XXX XXX" />
                      </Field>
                      <Field label="Email">
                        <Input value={newCompany.email} onChange={v => setNC('email', v)} placeholder="info@company.co.ke" type="email" />
                      </Field>
                      <Field label="Address">
                        <Input value={newCompany.address} onChange={v => setNC('address', v)} placeholder="Nairobi" />
                      </Field>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNewCompanyForm(false)}
                      className="text-xs"
                      style={{ color: 'var(--text-3)' }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Selected company chip */}
                {selectedCompany && (
                  <div className="flex items-center justify-between p-3 rounded-xl mb-4 animate-in fade-in duration-200" style={{ background: '#ECEDF8', border: `1px solid ${NAVY}20` }}>
                    <div>
                      <div className="text-xs font-black" style={{ color: NAVY }}>{selectedCompany.name}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{selectedCompany.phone}</div>
                      {priorCompanyRepairs > 0 && (
                        <div className="text-[10px] font-bold mt-0.5" style={{ color: CYAN }}>
                          🔁 {priorCompanyRepairs} prior repair{priorCompanyRepairs !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => { setSelectedCompany(null); setSelectedPersonId(''); setShowNewPersonForm(false) }}
                      className="text-xs px-2 py-1 rounded-lg" style={{ color: '#EF4444', background: '#FEF2F2' }}>
                      Change
                    </button>
                  </div>
                )}

                {/* Contact person section — only show when company is resolved */}
                {(selectedCompany || (showNewCompanyForm && newCompany.name)) && (
                  <>
                    <div className="mt-2 mb-3 flex items-center gap-2">
                      <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                      <span className="text-[10px] font-black uppercase tracking-widest px-2" style={{ color: 'var(--text-3)' }}>Contact Person</span>
                      <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                    </div>

                    {/* Existing persons list */}
                    {companyPersons.length > 0 && !showNewPersonForm && (
                      <div className="space-y-2 mb-3">
                        {companyPersons.map(p => (
                          <label
                            key={p.id}
                            className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                            style={selectedPersonId === p.id
                              ? { background: '#E0F6FE', border: `1px solid ${CYAN}` }
                              : { background: 'var(--bg-surface)', border: '1px solid var(--border)' }
                            }
                          >
                            <input
                              type="radio"
                              name="contactPerson"
                              value={p.id}
                              checked={selectedPersonId === p.id}
                              onChange={() => { setSelectedPersonId(p.id); setShowNewPersonForm(false) }}
                              style={{ accentColor: CYAN }}
                            />
                            <div className="flex-1">
                              <div className="text-xs font-bold" style={{ color: NAVY }}>
                                {p.firstName} {p.lastName}
                              </div>
                              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                {p.jobTitle && <span>{p.jobTitle} · </span>}{p.phone}
                              </div>
                            </div>
                            {p.isPrimary && (
                              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: '#E0F6FE', color: CYAN }}>PRIMARY</span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Add new person toggle */}
                    {!showNewPersonForm ? (
                      <button
                        type="button"
                        onClick={() => { setShowNewPersonForm(true); setSelectedPersonId('') }}
                        className="text-xs font-bold flex items-center gap-1.5"
                        style={{ color: CYAN }}
                      >
                        <Fa icon={faPlusCircle} />
                        {companyPersons.length === 0 ? 'Add contact person' : 'Add new contact person'}
                      </button>
                    ) : (
                      <div className="space-y-3 p-4 rounded-xl animate-in slide-in-from-top-2 duration-200" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: NAVY }}>New Contact Person</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="First Name" required>
                            <Input value={newPerson.firstName} onChange={v => setNP('firstName', v)} placeholder="John" />
                          </Field>
                          <Field label="Last Name">
                            <Input value={newPerson.lastName} onChange={v => setNP('lastName', v)} placeholder="Mutua" />
                          </Field>
                          <Field label="Phone" required>
                            <Input value={newPerson.phone} onChange={v => setNP('phone', v)} placeholder="+254 7XX XXX XXX" />
                          </Field>
                          <Field label="Email">
                            <Input value={newPerson.email} onChange={v => setNP('email', v)} placeholder="john@company.co.ke" type="email" />
                          </Field>
                          <Field label="Job Title">
                            <Input value={newPerson.jobTitle} onChange={v => setNP('jobTitle', v)} placeholder="IT Manager" />
                          </Field>
                        </div>
                        {companyPersons.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowNewPersonForm(false)}
                            className="text-xs"
                            style={{ color: 'var(--text-3)' }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {/* 3. Device Section */}
            <section className="card p-6" style={{ borderLeft: '4px solid #8B5CF6' }}>
              <div className="flex items-center gap-2 mb-5">
                <div className="p-1.5 rounded-lg" style={{ background: '#F5F3FF', color: '#7C3AED' }}>
                  <Fa icon={faMicrochip} />
                </div>
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>Device Specifications</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Device Type" required>
                  <Select value={device.deviceType} onChange={v => setD('deviceType', v)}
                    options={DEVICE_TYPES.map(dt => ({ value: dt.id, label: `${dt.icon}  ${dt.label}` }))} />
                </Field>
                {device.deviceType === 'other' && (
                  <Field label="Specify Type" required>
                    <Input value={device.customDeviceType} onChange={v => setD('customDeviceType', v)} placeholder="e.g. Smart TV" />
                  </Field>
                )}
                <Field label="Brand" required>
                  <Input value={device.brand} onChange={v => setD('brand', v)} placeholder="HP, Apple, Dell…" />
                </Field>
                <Field label="Model" required>
                  <Input value={device.model} onChange={v => setD('model', v)} placeholder="MacBook Pro 2022" />
                </Field>
                <Field label="Serial / IMEI" hint="Duplicate check based on this">
                  <div className="relative space-y-3">
                    <Input value={device.serial} onChange={v => setD('serial', v)} placeholder="Unique identifier…" />
                    <label className="flex items-start gap-3 rounded-xl p-3 cursor-pointer" style={{ background: device.serialWarrantyException ? '#FFFBEB' : 'var(--bg-surface)', border: `1px solid ${device.serialWarrantyException ? '#FDE68A' : 'var(--border)'}` }}>
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={device.serialWarrantyException}
                        onChange={e => setD('serialWarrantyException', e.target.checked)}
                      />
                      <span className="text-[10px] font-semibold leading-relaxed" style={{ color: device.serialWarrantyException ? '#92400E' : 'var(--text-3)' }}>
                        Serial/warranty label not readable or device cannot power on. Mark this only when the serial, IMEI, or bottom warranty text cannot be confirmed at intake.
                      </span>
                    </label>
                    {device.serialWarrantyException && (
                      <div className="space-y-3 rounded-xl p-3 animate-in slide-in-from-top-2 duration-200" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                        <Field label="Reason" required>
                          <Select value={device.serialWarrantyExceptionReason} onChange={v => setD('serialWarrantyExceptionReason', v)}
                            options={[
                              { value: '', label: 'Select reason…' },
                              { value: 'device_cannot_power_on', label: 'Device cannot power on' },
                              { value: 'label_unreadable', label: 'Bottom label / warranty text unreadable' },
                              { value: 'sticker_missing', label: 'Sticker missing' },
                              { value: 'customer_unable_to_confirm', label: 'Customer unable to confirm' },
                              { value: 'other', label: 'Other' },
                            ]} />
                        </Field>
                        <Field label="Notes">
                          <Textarea value={device.serialWarrantyExceptionNotes} onChange={v => setD('serialWarrantyExceptionNotes', v)} placeholder="Add any intake observation, e.g. no power, worn label, casing damaged…" rows={2} />
                        </Field>
                        <p className="text-[10px] font-bold leading-relaxed" style={{ color: '#92400E' }}>
                          This only allows intake to proceed and flags warranty verification for manual review. It does not approve warranty cover. Client-caused damage remains chargeable even if warranty is later confirmed.
                        </p>
                      </div>
                    )}
                    {duplicateRepair && (
                      <div className="mt-2 flex items-center gap-2 p-2 rounded-xl animate-pulse" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
                        <Fa icon={faExclamationTriangle} className="text-xs" />
                        <p className="text-[10px] font-bold uppercase">ALREADY IN: {duplicateRepair.ref}</p>
                      </div>
                    )}
                  </div>
                </Field>
                <Field label="Condition">
                  <Select value={device.deviceCondition} onChange={v => setD('deviceCondition', v)}
                    options={[
                      { value: 'good',    label: 'Good — Clean' },
                      { value: 'fair',    label: 'Fair — Scratches' },
                      { value: 'poor',    label: 'Poor — Dents' },
                      { value: 'damaged', label: 'Damaged — Broken' },
                    ]} />
                </Field>
                <Field label="Client Laptop Password" hint="Optional; visible only to staff on the repair job">
                  <Input
                    value={device.clientLaptopPassword}
                    onChange={v => setD('clientLaptopPassword', v)}
                    placeholder="Password / PIN shared by client…"
                    autoComplete="off"
                  />
                </Field>
              </div>

              {/* Warranty badge */}
              {device.serialWarrantyException && (
                <div className="mt-4 flex items-center gap-3 p-3 rounded-xl animate-in zoom-in-95 duration-300" style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
                  <Fa icon={faExclamationTriangle} className="text-sm" />
                  <div className="flex-1">
                    <p className="text-xs font-bold">Warranty Verification Pending</p>
                    <p className="text-[10px] opacity-90">Serial or warranty text could not be verified during intake. Technician or authorised staff must confirm coverage later.</p>
                  </div>
                </div>
              )}
              {device.serial.trim().length >= 4 && !duplicateRepair && !device.serialWarrantyException && (
                <div className="mt-4 animate-in zoom-in-95 duration-300">
                  {matchedWarranty ? (
                    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534' }}>
                      <Fa icon={faShieldAlt} style={{ color: '#16A34A', fontSize: 18 }} />
                      <div className="flex-1">
                        <p className="text-xs font-bold">Active Warranty Found</p>
                        <p className="text-[10px] opacity-80">{matchedWarranty.ref} · Expires {fmtDate(matchedWarranty.endDate)}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-white text-[9px] font-black" style={{ background: '#16A34A' }}>COVERED</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
                      <Fa icon={faShieldAlt} style={{ opacity: 0.3 }} />
                      <p className="text-[10px] font-bold uppercase tracking-tight">No active warranty for this serial</p>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 4. Job Details */}
            <section className="card p-6" style={{ borderLeft: '4px solid #10B981' }}>
              <div className="flex items-center gap-2 mb-5">
                <div className="p-1.5 rounded-lg" style={{ background: '#ECFDF5', color: '#059669' }}>
                  <Fa icon={faClipboardList} />
                </div>
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>Job Details</h3>
              </div>
              <div className="space-y-4">
                <Field label="Reported Issue" required>
                  <Textarea value={device.issueDesc} onChange={v => setD('issueDesc', v)} placeholder="Describe what's wrong with the device…" rows={3} />
                </Field>
                <Field label="Accessories Included" hint="Check all items received with the device">
                  {(() => {
                    const COMMON_ACCESSORIES = [
                      'Charger / Adapter', 'Laptop Bag', 'Mouse', 'Keyboard',
                      'USB-C Cable', 'HDMI Cable', 'Power Cable', 'Docking Station',
                      'Stylus / Pen', 'External HDD', 'SIM Card', 'SD Card',
                    ]
                    const toggleAcc = (name: string) => {
                      setDevice(p => {
                        const next = new Set(p.accessoriesChecked)
                        next.has(name) ? next.delete(name) : next.add(name)
                        return { ...p, accessoriesChecked: next }
                      })
                    }
                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          {COMMON_ACCESSORIES.map(acc => {
                            const checked = device.accessoriesChecked.has(acc)
                            return (
                              <label
                                key={acc}
                                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer select-none transition-colors"
                                style={{
                                  background: checked ? 'rgba(0,174,239,0.10)' : 'var(--bg-surface)',
                                  border: `1px solid ${checked ? '#00AEEF' : 'var(--border)'}`,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 rounded accent-[#00AEEF] cursor-pointer"
                                  checked={checked}
                                  onChange={() => toggleAcc(acc)}
                                />
                                <span className="text-xs font-medium" style={{ color: checked ? '#00AEEF' : 'var(--text-2)' }}>{acc}</span>
                              </label>
                            )
                          })}
                        </div>
                        <Input
                          value={device.accessoriesOther}
                          onChange={v => setDevice(p => ({ ...p, accessoriesOther: v }))}
                          placeholder="Other accessories (comma-separated)…"
                        />
                      </div>
                    )
                  })()}
                </Field>
              </div>
            </section>
          </div>

          {/* ── Sidebar Column ───────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Priority & Channel */}
            <section className="card p-5">
              <p className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: 'var(--text-3)' }}>Priority & Channel</p>
              <div className="space-y-3">
                <Field label="Priority">
                  <Select value={device.priority} onChange={v => setD('priority', v)}
                    options={[
                      { value: 'low',    label: 'Low' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'high',   label: 'High' },
                      { value: 'urgent', label: '🔴 Urgent' },
                    ]} />
                </Field>
                <Field label="Intake Channel">
                  <Select value={device.intakeChannel} onChange={v => setD('intakeChannel', v)}
                    options={[
                      { value: 'walk_in',      label: 'Walk-in' },
                      { value: 'rider_pickup', label: 'Rider Pickup' },
                      { value: 'website',      label: 'Website' },
                      { value: 'whatsapp',     label: 'WhatsApp' },
                      { value: 'call',         label: 'Phone Call' },
                      { value: 'email',        label: 'Email' },
                    ]} />
                </Field>
                <Field label="Est. Completion">
                  <Input type="date" value={device.estimatedCompletion} onChange={v => setD('estimatedCompletion', v)} />
                </Field>
              </div>
            </section>

            {/* Workflow Selection */}
            <section className="card p-5">
              <p className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: 'var(--text-3)' }}>Workflow Path</p>
              <div className="flex flex-col gap-3">
                {([
                  { value: 'diagnosis_first', icon: '🔍', title: 'Diagnosis First', desc: 'Tech inspects before quoting.' },
                  { value: 'direct_repair',   icon: '🔧', title: 'Direct Repair',   desc: 'Bypass inspection.' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setD('repairPath', opt.value)}
                    className="p-4 rounded-xl border-2 text-left transition-all active:scale-[0.98]"
                    style={device.repairPath === opt.value
                      ? { background: '#E0F6FE', borderColor: CYAN }
                      : { background: 'var(--bg-surface)', borderColor: 'var(--border)' }
                    }
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-lg">{opt.icon}</span>
                      <span className="text-xs font-bold" style={{ color: device.repairPath === opt.value ? CYAN : 'var(--text-1)' }}>{opt.title}</span>
                    </div>
                    <p className="text-[10px] leading-relaxed font-medium" style={{ color: 'var(--text-3)' }}>{opt.desc}</p>
                  </button>
                ))}
              </div>

              {device.repairPath === 'direct_repair' && (
                <div className="mt-4 p-4 rounded-xl space-y-3 animate-in slide-in-from-top-2 duration-300" style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
                  <div className="flex items-center gap-2" style={{ color: '#6D28D9' }}>
                    <Fa icon={faSignature} className="text-sm" />
                    <p className="text-[10px] font-black uppercase tracking-widest">Customer Consent</p>
                  </div>
                  <Field label="Customer Signature" required>
                    <Input value={device.consentSignature} onChange={v => setD('consentSignature', v)} placeholder="Type full name as signature" />
                  </Field>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={device.agreeTerms} onChange={e => setD('agreeTerms', e.target.checked)} />
                    <span className="text-[10px] font-medium leading-tight" style={{ color: 'var(--text-3)' }}>
                      I agree to the terms and authorise immediate repair.
                    </span>
                  </label>
                </div>
              )}
            </section>

            {/* Notice */}
            <div className="card p-4" style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
              <div className="flex items-center gap-2 mb-2" style={{ color: '#B45309' }}>
                <Fa icon={faExclamationTriangle} className="text-xs" />
                <span className="text-[10px] font-black uppercase tracking-widest">Important</span>
              </div>
              <p className="text-[10px] leading-relaxed font-medium" style={{ color: '#92400E' }}>
                Document all physical damage and inform the customer of the estimated completion date.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
