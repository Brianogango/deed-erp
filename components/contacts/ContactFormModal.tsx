'use client'

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_CONTACT_PAYMENT_TERMS_DAYS } from '@/lib/sales/quotation-defaults'
import type { Contact } from '@/lib/store'
import { useCrmStore } from '@/lib/store'
import { SlidePanel, Field, Input, Select, Textarea } from '@/components/ui'
import { Fa, faBuilding, faUser } from '@/components/icons'

function focusFieldControl(fieldId: string) {
  const el = document.getElementById(fieldId)
  if (!el) return
  const target = el.matches('input, select, textarea')
    ? el
    : el.querySelector<HTMLElement>('input, select, textarea, [tabindex]')
  ;(target as HTMLElement | null)?.focus?.()
}

export const CONTACT_INDUSTRIES = [
  'Financial Services', 'Telecommunications', 'Electronics', 'IT Services',
  'Healthcare', 'Education', 'Retail', 'Manufacturing', 'Construction',
  'Real Estate', 'Hospitality', 'Transport & Logistics', 'Agriculture',
  'Government', 'NGO / Non-profit', 'Media & Entertainment', 'Other',
] as const

/** Standard payment-terms presets (days). Default remains 30; 0 = cash / due immediately. */
export const PAYMENT_TERMS_DAY_OPTIONS = [
  { value: '0', label: 'Cash / due immediately (0 days)' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '45', label: '45 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
] as const

export type ContactFormValues = Omit<Contact, 'id' | 'createdAt'>

export function blankCompanyContact(overrides: Partial<ContactFormValues> = {}): ContactFormValues {
  return {
    type: 'company', name: '', tradingName: '', registrationNumber: '', vatNumber: '',
    industry: '', email: '', phone: '', mobile: '', website: '',
    address: '', postalAddress: '', city: '', country: 'Kenya',
    isCustomer: true, isVendor: false, tags: [],
    paymentTermsDays: DEFAULT_CONTACT_PAYMENT_TERMS_DAYS, creditLimit: 0,
    bankName: '', bankAccount: '', bankBranch: '',
    notes: '',
    ...overrides,
  }
}

export function blankIndividualContact(overrides: Partial<ContactFormValues> = {}): ContactFormValues {
  return {
    type: 'individual', name: '', jobTitle: '', idNumber: '', vatNumber: '',
    email: '', phone: '', mobile: '',
    address: '', city: '', country: 'Kenya',
    companyId: undefined,
    isCustomer: true, isVendor: false, tags: [],
    paymentTermsDays: DEFAULT_CONTACT_PAYMENT_TERMS_DAYS,
    notes: '',
    ...overrides,
  }
}

type Props = {
  /** Existing contact id when editing; omit for create. */
  editId?: string | null
  /** Initial form values (create or edit). */
  initial: ContactFormValues
  onClose: () => void
  /** Called after a successful create/update with the saved contact. */
  onSaved: (contact: Contact) => void
  /** Force customer flag (e.g. from Sales / Trade-in / Repair). */
  forceCustomer?: boolean
  /** Force vendor flag (e.g. from Purchase RFQ). */
  forceVendor?: boolean
}

/**
 * Full Contacts-module create/edit form — shared by Contacts and other modules.
 */
export default function ContactFormModal({
  editId = null,
  initial,
  onClose,
  onSaved,
  forceCustomer = false,
  forceVendor = false,
}: Props) {
  const { contacts, addContact, updateContact, showToast } = useCrmStore()
  const [form, setForm] = useState<ContactFormValues>(() => ({
    ...initial,
    paymentTermsDays: initial.paymentTermsDays ?? DEFAULT_CONTACT_PAYMENT_TERMS_DAYS,
    ...(forceCustomer ? { isCustomer: true } : {}),
    ...(forceVendor ? { isVendor: true } : {}),
  }))
  const [saving, setSaving] = useState(false)
  type DetailsTab = 'other' | 'address' | 'persons' | 'remarks' | 'documents'
  const [activeDetailsTab, setActiveDetailsTab] = useState<DetailsTab>('other')
  type PersonDraft = { id?: string; salutation: string; firstName: string; lastName: string; email: string; phone: string; mobile: string; position: string }
  const blankPerson = (): PersonDraft => ({ salutation: '', firstName: '', lastName: '', email: '', phone: '', mobile: '', position: '' })
  const [contactPersons, setContactPersons] = useState<PersonDraft[]>([])
  const [deletedPersonIds, setDeletedPersonIds] = useState<string[]>([])

  useEffect(() => {
    if (!editId || form.type !== 'company') {
      setContactPersons([])
      setDeletedPersonIds([])
      return
    }
    let cancelled = false
    fetch('/api/contact-persons', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : [])
      .then((rows: any[]) => {
        if (cancelled) return
        setContactPersons(rows.filter(row => row.clientId === editId).map(row => ({
          id: row.id,
          salutation: row.salutation ?? '',
          firstName: row.firstName ?? '',
          lastName: row.lastName ?? '',
          email: row.email ?? '',
          phone: row.phone ?? '',
          mobile: row.mobile ?? '',
          position: row.position ?? '',
        })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [editId, form.type])

  const updatePerson = (index: number, key: keyof PersonDraft, value: string) => {
    setContactPersons(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row))
  }

  const removePerson = (index: number) => {
    setContactPersons(rows => {
      const person = rows[index]
      if (person?.id) setDeletedPersonIds(ids => [...ids, person.id!])
      return rows.filter((_, i) => i !== index)
    })
  }
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name', string>>>({})
  // React 18's DetailsHTMLAttributes has `open`/`onToggle` but not `defaultOpen`.
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(() => Boolean(editId))

  const companies = useMemo(
    () => contacts.filter(c => c.type === 'company' && c.id !== editId),
    [contacts, editId],
  )

  const detailsTabs = useMemo<readonly (readonly [DetailsTab, string])[]>(() => (
    form.type === 'company'
      ? [
          ['other', 'Business Details'],
          ['address', 'Address'],
          ['persons', 'Contact Persons'],
          ['remarks', 'Remarks'],
          ['documents', 'Company Documents'],
        ]
      : [
          ['other', 'Personal Details'],
          ['address', 'Address'],
          ['remarks', 'Remarks'],
          ['documents', 'Identity Documents'],
        ]
  ), [form.type])

  useEffect(() => {
    if (form.type === 'individual' && activeDetailsTab === 'persons') {
      setActiveDetailsTab('other')
    }
  }, [form.type, activeDetailsTab])

  const paymentTermsValue = String(form.paymentTermsDays ?? DEFAULT_CONTACT_PAYMENT_TERMS_DAYS)
  const paymentTermsOptions = useMemo(() => {
    const base: Array<{ value: string; label: string }> = PAYMENT_TERMS_DAY_OPTIONS.map(o => ({
      value: o.value,
      label: o.label,
    }))
    if (!base.some(o => o.value === paymentTermsValue)) {
      base.push({ value: paymentTermsValue, label: `${paymentTermsValue} days` })
    }
    return base
  }, [paymentTermsValue])

  const f = (k: keyof ContactFormValues) => (v: unknown) => {
    setForm(prev => ({ ...prev, [k]: v }))
    if (k === 'name' && fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: undefined }))
  }

  const switchType = (type: 'company' | 'individual') => {
    if (type === form.type) return
    const shared = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      mobile: form.mobile,
      address: form.address,
      city: form.city,
      country: form.country,
      notes: form.notes,
      isCustomer: forceCustomer ? true : form.isCustomer,
      isVendor: forceVendor ? true : form.isVendor,
      tags: form.tags,
      paymentTermsDays: form.paymentTermsDays ?? DEFAULT_CONTACT_PAYMENT_TERMS_DAYS,
      creditLimit: form.creditLimit ?? 0,
    }
    setForm(type === 'company'
      ? blankCompanyContact(shared)
      : blankIndividualContact(shared))
  }

  const save = async () => {
    if (!form.name.trim()) {
      setFieldErrors({ name: form.type === 'company' ? 'Company name is required' : 'Full name is required' })
      showToast('Please fix the highlighted fields', 'error')
      requestAnimationFrame(() => focusFieldControl('contact-name'))
      return
    }
    setFieldErrors({})
    setSaving(true)
    try {
      const payload: ContactFormValues = {
        ...form,
        name: form.name.trim(),
        ...(forceCustomer ? { isCustomer: true } : {}),
        ...(forceVendor ? { isVendor: true } : {}),
      }
      if (form.type === 'individual') {
        payload.tradingName = undefined
        payload.registrationNumber = undefined
        payload.industry = undefined
        payload.postalAddress = undefined
        payload.vatNumber = undefined
        payload.bankName = undefined
        payload.bankAccount = undefined
        payload.bankBranch = undefined
      } else {
        payload.jobTitle = undefined
        payload.idNumber = undefined
        payload.companyId = undefined
      }
      const contact = editId
        ? await updateContact(editId, payload)
        : await addContact(payload)
      const savedContact = contact as Contact
      const validPersons = form.type === 'company'
        ? contactPersons.filter(person => person.firstName.trim() || person.lastName.trim() || person.email.trim())
        : []
      try {
        if (form.type === 'company') await Promise.all([
        ...validPersons.map(person => fetch(person.id ? `/api/contact-persons/${person.id}` : '/api/contact-persons', {
          method: person.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: savedContact.id,
            firstName: [person.salutation, person.firstName].filter(Boolean).join(' ').trim(),
            lastName: person.lastName.trim(),
            email: person.email.trim() || null,
            phone: person.phone.trim() || person.mobile.trim() || null,
            position: person.position.trim() || null,
          }),
        }).then(res => {
          if (!res.ok) throw new Error('Could not save contact person')
          return res
        })),
        ...deletedPersonIds.map(id => fetch(`/api/contact-persons/${id}`, { method: 'DELETE' }).then(res => {
          if (!res.ok) throw new Error('Could not remove contact person')
          return res
        })),
        ])
      } catch {
        showToast('Contact saved, but some contact-person changes could not be applied. Reopen the contact to retry.', 'error')
      }
      onSaved(savedContact)
    } catch {
      // store helpers already toast
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlidePanel
      variant="workspace"
      title={editId ? `Edit ${form.name || 'contact'}` : forceVendor ? 'New Vendor' : forceCustomer ? 'New Customer' : 'New Contact'}
      subtitle={editId ? 'Update contact information' : forceVendor ? 'Add a supplier for purchasing and vendor bills' : forceCustomer ? 'Add a customer for quotations, invoices and service records' : 'Add a person or company to your ERP contacts'}
      onClose={onClose}
    >
      <div className={`contacts-form-sheet contacts-form-sheet--${form.type}`}>
      <div className="form-workspace-section-heading">
        <strong>{forceVendor ? 'Vendor' : forceCustomer ? 'Customer' : 'Contact'}</strong>
        <span>{forceVendor ? 'Supplier identity and purchasing details' : 'The display name is used across quotations, invoices and statements'}</span>
      </div>
      <div className="contacts-type-switch" role="group" aria-label="Contact type">
        {(['company', 'individual'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => switchType(t)}
            className={form.type === t ? 'is-active' : ''}
            aria-pressed={form.type === t}
          >
            {t === 'individual'
              ? <><Fa icon={faUser} /> <span><strong>Individual</strong><small>Person / contact</small></span></>
              : <><Fa icon={faBuilding} /> <span><strong>Business</strong><small>Company / organisation</small></span></>}
          </button>
        ))}
      </div>
      {editId && (
        <p className="contacts-type-switch-hint">
          Created as the wrong kind? Switch Individual ↔ Business, then Save. Name, email and phone are kept.
        </p>
      )}

      <div className="contacts-form-grid contacts-form-grid--progressive">
        {form.type === 'company' ? (
          <>
            <div className="contacts-form-wide">
              <Field label="Company Name" required id="contact-name" error={fieldErrors.name}>
                <Input value={form.name} onChange={f('name')} placeholder="e.g. Acme Corporation Ltd" autoFocus />
              </Field>
            </div>
            <Field label="Phone">
              <Input value={form.phone} onChange={f('phone')} type="tel" placeholder="+254 700 000 000" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={f('email')} type="email" placeholder="info@company.com" maxLength={100} />
            </Field>
            <Field label="KRA PIN">
              <Input value={form.vatNumber ?? ''} onChange={f('vatNumber')} placeholder="e.g. P051130572W" />
            </Field>
            <Field label="Industry">
              <Select
                value={form.industry ?? ''}
                onChange={f('industry')}
                options={[{ value: '', label: 'Select industry...' }, ...CONTACT_INDUSTRIES.map(i => ({ value: i, label: i }))]}
              />
            </Field>
          </>
        ) : (
          <>
            <div className="contacts-form-wide">
              <Field label="Linked Company">
                <Select
                  value={form.companyId ?? ''}
                  onChange={f('companyId')}
                  options={[{ value: '', label: 'No company / Independent' }, ...companies.map(c => ({ value: c.id, label: c.name }))]}
                />
              </Field>
            </div>
            <div className="contacts-form-wide">
              <Field label="Full Name" required id="contact-name" error={fieldErrors.name}>
                <Input value={form.name} onChange={f('name')} placeholder="e.g. John Kamau Mwangi" autoFocus />
              </Field>
            </div>
            <div className="contacts-form-wide">
              <Field label="Job Title">
                <Input value={form.jobTitle ?? ''} onChange={f('jobTitle')} placeholder="e.g. IT Manager" />
              </Field>
            </div>
            <Field label="Email">
              <Input value={form.email} onChange={f('email')} type="email" placeholder="name@company.com" maxLength={100} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={f('phone')} type="tel" placeholder="+254 700 000 000" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
            </Field>
            <div className="contacts-form-wide contacts-form-mobile-field">
              <Field label="Mobile">
                <Input value={form.mobile ?? ''} onChange={f('mobile')} type="tel" placeholder="+254 700 000 000" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
              </Field>
            </div>
          </>
        )}

        <div className="contacts-form-relationship-block">
          <div className="contacts-form-inline-heading">
            <div>
              <strong>Business relationship</strong>
              <span>Select one or both</span>
            </div>
          </div>
          <div className="contacts-relationship-options contacts-relationship-options--compact">
            <label className={form.isCustomer ? 'is-selected' : ''}>
              <input
                type="checkbox"
                checked={form.isCustomer}
                disabled={forceCustomer}
                onChange={e => f('isCustomer')(e.target.checked)}
              />
              <span><strong>Customer</strong><small>Buys from us</small></span>
            </label>
            <label className={form.isVendor ? 'is-selected' : ''}>
              <input
                type="checkbox"
                checked={form.isVendor}
                disabled={forceVendor}
                onChange={e => f('isVendor')(e.target.checked)}
              />
              <span><strong>Vendor</strong><small>Supplies to us</small></span>
            </label>
          </div>
        </div>

        <section className="contacts-details-tabs">
          <nav className="contacts-details-tabs__nav" aria-label="Additional contact details">
            {detailsTabs.map(([id, label]) => (
              <button key={id} type="button" className={activeDetailsTab === id ? 'is-active' : ''} onClick={() => setActiveDetailsTab(id)}>
                {label}{id === 'persons' && contactPersons.length > 0 ? <span>{contactPersons.length}</span> : null}
              </button>
            ))}
          </nav>

          <div className="contacts-details-tabs__panel">
            {activeDetailsTab === 'other' && (
              <div className="contacts-form-optional__grid">
                {form.type === 'company' ? (
                  <>
                    <Field label="Registration Number" hint="As shown on the certificate of incorporation">
                      <Input value={form.registrationNumber ?? ''} onChange={f('registrationNumber')} placeholder="e.g. PVT-ABCD123" />
                    </Field>
                    <Field label="Trading Name">
                      <Input value={form.tradingName ?? ''} onChange={f('tradingName')} placeholder="Business name (if different)" />
                    </Field>
                    <Field label="KRA PIN" hint="Shown on invoices and tax documents">
                      <Input value={form.vatNumber ?? ''} onChange={f('vatNumber')} placeholder="e.g. P051234567X" />
                    </Field>
                    <Field label="Currency" hint="Defaults to your base currency">
                      <Input value="KES — Kenyan Shilling" onChange={() => {}} disabled />
                    </Field>
                    <Field label="Credit limit (KES)" hint="Maximum approved account exposure">
                      <Input value={String(form.creditLimit ?? '')} onChange={v => f('creditLimit')(Number(v) || 0)} placeholder="0.00" />
                    </Field>
                    <Field label="Payment terms" hint="Used to calculate invoice due dates">
                      <Select value={paymentTermsValue} onChange={v => f('paymentTermsDays')(Number(v))} options={paymentTermsOptions} />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="National ID / Passport Number" hint="For identification where required">
                      <Input value={form.idNumber ?? ''} onChange={f('idNumber')} placeholder="National ID or passport number" />
                    </Field>
                    <Field label="Payment terms" hint="Used when this individual buys on account">
                      <Select value={paymentTermsValue} onChange={v => f('paymentTermsDays')(Number(v))} options={paymentTermsOptions} />
                    </Field>
                  </>
                )}
                <div className="contacts-form-wide">
                  <Field label="Reporting tags" hint="Press Enter or use commas to separate tags">
                    <Input value={(form.tags ?? []).join(', ')} onChange={v => f('tags')(String(v).split(',').map(tag => tag.trim()).filter(Boolean))} placeholder={form.type === 'company' ? 'vip, wholesale...' : 'vip, retail...'} />
                  </Field>
                </div>
              </div>
            )}

            {activeDetailsTab === 'address' && (
              <div className="contacts-form-optional__grid">
                <div className="contacts-form-wide"><Field label="Physical Address"><Input value={form.address} onChange={f('address')} placeholder="Street / Building, Area" /></Field></div>
                {form.type === 'company' && <Field label="Postal Address"><Input value={form.postalAddress ?? ''} onChange={f('postalAddress')} placeholder="P.O. Box 00000-00100" /></Field>}
                <Field label="City"><Input value={form.city ?? ''} onChange={f('city')} placeholder="e.g. Nairobi" /></Field>
                <Field label="Country"><Input value={form.country ?? ''} onChange={f('country')} placeholder="e.g. Kenya" /></Field>
              </div>
            )}

            {activeDetailsTab === 'persons' && (
              <div className="contacts-persons-editor">
                <header><strong>Contact Persons</strong><span>People authorised to represent or transact for this company</span></header>
                {contactPersons.map((person, index) => (
                  <div className="contacts-person-card" key={person.id ?? index}>
                    <Select value={person.salutation} onChange={v => updatePerson(index, 'salutation', String(v))} options={[{value:'',label:'Salutation'},{value:'Mr',label:'Mr'},{value:'Ms',label:'Ms'},{value:'Mrs',label:'Mrs'},{value:'Dr',label:'Dr'}]} />
                    <Input value={person.firstName} onChange={v => updatePerson(index, 'firstName', String(v))} placeholder="First name" />
                    <Input value={person.lastName} onChange={v => updatePerson(index, 'lastName', String(v))} placeholder="Last name" />
                    <Input value={person.email} onChange={v => updatePerson(index, 'email', String(v))} type="email" placeholder="Email" />
                    <Input value={person.phone} onChange={v => updatePerson(index, 'phone', String(v))} type="tel" placeholder="Work phone" />
                    <Input value={person.mobile} onChange={v => updatePerson(index, 'mobile', String(v))} type="tel" placeholder="Mobile" />
                    <Input value={person.position} onChange={v => updatePerson(index, 'position', String(v))} placeholder="Designation (e.g. Accountant)" />
                    <button type="button" className="contacts-person-remove" onClick={() => removePerson(index)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn-outline contacts-person-add" onClick={() => setContactPersons(rows => [...rows, blankPerson()])}>+ Add contact person</button>
              </div>
            )}

            {activeDetailsTab === 'remarks' && (
              <Field label="Internal remarks" hint="Preferences, context or useful information for your team">
                <Textarea value={form.notes ?? ''} onChange={f('notes')} placeholder="Add internal notes..." rows={6} />
              </Field>
            )}

            {activeDetailsTab === 'documents' && (
              <div className="contacts-documents-empty">
                <strong>{form.type === 'company' ? 'Company Documents' : 'Identity Documents'}</strong>
                <span>
                  {form.type === 'company'
                    ? 'Save the company, then attach its CR12, certificate of incorporation, KRA PIN certificate and other compliance documents from the contact record.'
                    : 'Save the individual, then attach a National ID or passport only when identification is required.'}
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="contacts-form-footer">
        <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : editId ? 'Save Changes' : form.type === 'company' ? 'Create Company' : 'Create Contact'}
        </button>
      </div>
      </div>
    </SlidePanel>
  )
}
