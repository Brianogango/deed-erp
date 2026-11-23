'use client'
import { kraPinWarning } from '@/lib/contacts/kra-pin'

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_CONTACT_PAYMENT_TERMS_DAYS } from '@/lib/sales/quotation-defaults'
import type { Contact } from '@/lib/store'
import { useCrmStore } from '@/lib/store'
import { SlidePanel, Field, Input, Select, Textarea } from '@/components/ui'
import { Fa, faBuilding, faUser } from '@/components/icons'
import { userCan } from '@/lib/auth/can'

function focusFieldControl(fieldId: string) {
  const el = document.getElementById(fieldId)
  if (!el) return
  const target = el.matches('input, select, textarea')
    ? el
    : el.querySelector<HTMLElement>('input, select, textarea, [tabindex]')
  ;(target as HTMLElement | null)?.focus?.()
}

/** Standard payment-terms presets (days); 0 = cash / due immediately. New contacts start with none selected. */
const PAYMENT_TERMS_DAY_OPTIONS = [
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
    address: '', postalAddress: '', city: '', country: '',
    isCustomer: true, isVendor: false, tags: [],
    // Country, payment terms and credit limit start empty — the user must set them.
    paymentTermsDays: undefined, creditLimit: undefined,
    bankName: '', bankAccount: '', bankBranch: '',
    notes: '',
    ...overrides,
  }
}

export function blankIndividualContact(overrides: Partial<ContactFormValues> = {}): ContactFormValues {
  return {
    type: 'individual', name: '', jobTitle: '', idNumber: '', vatNumber: '',
    email: '', phone: '', mobile: '',
    address: '', city: '', country: '',
    companyId: undefined,
    isCustomer: true, isVendor: false, tags: [],
    paymentTermsDays: undefined,
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
  const {
    contacts, addContact, updateContact, showToast,
    contactPersons: linkedPersons, createContactPerson, deleteContactPerson,
    users, currentUserId,
  } = useCrmStore()
  // Credit limit and payment terms are granted by Finance (credit applications).
  const canSetCreditTerms = userCan(users.find(u => u.id === currentUserId), 'sales.contacts.credit_terms')
  const creditTermsHint = 'Set by Finance through a credit account application (Contacts → Credit)'
  const [form, setForm] = useState<ContactFormValues>(() => ({
    ...initial,
    // Editing keeps the record's value (legacy rows fall back to the house default);
    // a new contact starts with no payment terms selected.
    paymentTermsDays: editId ? initial.paymentTermsDays ?? DEFAULT_CONTACT_PAYMENT_TERMS_DAYS : initial.paymentTermsDays,
    ...(forceCustomer ? { isCustomer: true } : {}),
    ...(forceVendor ? { isVendor: true } : {}),
  }))
  const [saving, setSaving] = useState(false)
  type DetailsTab = 'payment' | 'terms' | 'address' | 'persons' | 'remarks'
  const [activeDetailsTab, setActiveDetailsTab] = useState<DetailsTab>(() => (initial?.isVendor || forceVendor) && !forceCustomer ? 'payment' : 'terms')
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
    // Contact persons are individual contacts with this company as employer,
    // read straight from the directory. This used to fetch a separate
    // contact_persons table, which is why what you added here never showed up
    // on the company's detail panel — that panel reads the directory.
    setContactPersons(
      linkedPersons
        .filter(person => person.clientId === editId)
        .map(person => ({
          id: person.id,
          salutation: '',
          firstName: person.firstName ?? '',
          lastName: person.lastName ?? '',
          email: person.email ?? '',
          phone: person.phone ?? '',
          mobile: person.mobile ?? '',
          position: person.jobTitle ?? '',
        })),
    )
    setDeletedPersonIds([])
  }, [editId, form.type, linkedPersons])

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
  type ErrorField = 'name' | 'country' | 'paymentTermsDays' | 'creditLimit'
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ErrorField, string>>>({})
  // Credit limit is edited as text so a new record can stay blank until the user types it.
  const [creditLimitText, setCreditLimitText] = useState(() =>
    initial.creditLimit == null ? (editId ? '0' : '') : String(initial.creditLimit),
  )
  // React 18's DetailsHTMLAttributes has `open`/`onToggle` but not `defaultOpen`.

  const companies = useMemo(
    () => contacts.filter(c => c.type === 'company' && c.id !== editId),
    [contacts, editId],
  )

  // Only the sections that apply: payment details for vendors, credit and
  // terms for customers, contact persons for companies.
  const detailsTabs = useMemo<readonly (readonly [DetailsTab, string])[]>(() => {
    const tabs: Array<readonly [DetailsTab, string]> = []
    if (form.isVendor) tabs.push(['payment', 'Payment details'])
    tabs.push(['terms', form.isCustomer ? 'Credit & terms' : 'Terms'])
    tabs.push(['address', 'Address'])
    if (form.type === 'company') tabs.push(['persons', 'Contact persons'])
    tabs.push(['remarks', 'Notes'])
    return tabs
  }, [form.type, form.isVendor, form.isCustomer])

  useEffect(() => {
    if (!detailsTabs.some(([id]) => id === activeDetailsTab)) setActiveDetailsTab(detailsTabs[0][0])
  }, [detailsTabs, activeDetailsTab])

  // How the vendor is paid. Stored in the bank fields so nothing new is needed
  // on the server: bank → bank / branch / account; Paybill → "M-Pesa Paybill",
  // paybill number, account number; Till → "M-Pesa Till", till number;
  // Send money → "M-Pesa", phone number.
  type PayMethod = 'bank' | 'paybill' | 'till' | 'mpesa'
  const payMethod: PayMethod = (() => {
    const n = String(form.bankName ?? '').trim().toLowerCase()
    if (n === 'm-pesa paybill') return 'paybill'
    if (n === 'm-pesa till') return 'till'
    if (n === 'm-pesa') return 'mpesa'
    return 'bank'
  })()
  const setPayMethod = (m: PayMethod) => {
    if (m === payMethod) return
    setForm(prev => ({
      ...prev,
      bankName: m === 'paybill' ? 'M-Pesa Paybill' : m === 'till' ? 'M-Pesa Till' : m === 'mpesa' ? 'M-Pesa' : '',
      bankBranch: '',
      bankAccount: '',
    }))
  }

  const paymentTermsValue = form.paymentTermsDays == null ? '' : String(form.paymentTermsDays)
  const paymentTermsOptions = useMemo(() => {
    const base: Array<{ value: string; label: string }> = [
      { value: '', label: 'Select payment terms…' },
      ...PAYMENT_TERMS_DAY_OPTIONS.map(o => ({ value: o.value, label: o.label })),
    ]
    if (paymentTermsValue && !base.some(o => o.value === paymentTermsValue)) {
      base.push({ value: paymentTermsValue, label: `${paymentTermsValue} days` })
    }
    return base
  }, [paymentTermsValue])

  const f = (k: keyof ContactFormValues) => (v: unknown) => {
    setForm(prev => ({ ...prev, [k]: v }))
    if ((k === 'name' || k === 'country' || k === 'paymentTermsDays') && fieldErrors[k]) {
      setFieldErrors(prev => ({ ...prev, [k]: undefined }))
    }
  }

  const switchType = (type: 'company' | 'individual') => {
    if (type === form.type) return
    const shared = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      mobile: form.mobile,
      vatNumber: form.vatNumber,
      address: form.address,
      city: form.city,
      country: form.country,
      notes: form.notes,
      isCustomer: forceCustomer ? true : form.isCustomer,
      isVendor: forceVendor ? true : form.isVendor,
      tags: form.tags,
      paymentTermsDays: form.paymentTermsDays,
      creditLimit: form.creditLimit,
    }
    setForm(type === 'company'
      ? blankCompanyContact(shared)
      : blankIndividualContact(shared))
  }

  const save = async () => {
    const errors: Partial<Record<ErrorField, string>> = {}
    if (!form.name.trim()) errors.name = form.type === 'company' ? 'Company name is required' : 'Full name is required'
    if (canSetCreditTerms && form.isCustomer && (form.paymentTermsDays == null || !Number.isFinite(form.paymentTermsDays))) errors.paymentTermsDays = 'Payment terms are required'
    const creditLimitNum = creditLimitText.trim() === '' ? NaN : Number(creditLimitText)
    if (canSetCreditTerms && form.isCustomer && form.type === 'company' && (!Number.isFinite(creditLimitNum) || creditLimitNum < 0)) {
      errors.creditLimit = creditLimitText.trim() === '' ? 'Credit limit is required (enter 0 for none)' : 'Credit limit must be a number of 0 or more'
    }
    const errorKeys = Object.keys(errors) as ErrorField[]
    if (errorKeys.length) {
      setFieldErrors(errors)
      const labels: Record<ErrorField, string> = { name: form.type === 'company' ? 'Company name' : 'Full name', country: 'Country', paymentTermsDays: 'Payment terms', creditLimit: 'Credit limit' }
      showToast(`Please fill in: ${errorKeys.map(k => labels[k]).join(', ')}`, 'error')
      const first = errorKeys[0]
      if (first === 'paymentTermsDays' || first === 'creditLimit') setActiveDetailsTab('terms')
      requestAnimationFrame(() => focusFieldControl(first === 'name' ? 'contact-name' : `contact-${first}`))
      return
    }
    setFieldErrors({})
    setSaving(true)
    try {
      const payload: ContactFormValues = {
        ...form,
        name: form.name.trim(),
        country: (form.country ?? '').trim() || 'Kenya',
        ...(form.type === 'company' && canSetCreditTerms ? { creditLimit: creditLimitNum } : {}),
        ...(forceCustomer ? { isCustomer: true } : {}),
        ...(forceVendor ? { isVendor: true } : {}),
      }
      if (form.type === 'individual') {
        payload.tradingName = undefined
        payload.registrationNumber = undefined
        payload.industry = undefined
        payload.postalAddress = undefined
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
        if (form.type === 'company') {
          // Saved as directory contacts employed by this company, which is the
          // single place contact persons live now — so the detail panel, the
          // CRM pickers and this form all see the same people.
          for (const person of validPersons) {
            createContactPerson({
              clientId: savedContact.id,
              companyId: savedContact.id,
              companyName: savedContact.name,
              firstName: [person.salutation, person.firstName].filter(Boolean).join(' ').trim(),
              lastName: person.lastName.trim(),
              email: person.email.trim(),
              phone: person.phone.trim(),
              mobile: person.mobile.trim() || undefined,
              jobTitle: person.position.trim() || undefined,
            } as Parameters<typeof createContactPerson>[0])
          }
          for (const id of deletedPersonIds) deleteContactPerson(id)
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : ''
        showToast(
          detail || 'Contact saved, but some contact-person changes could not be applied. Reopen the contact to retry.', 'error')
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
        <div className="contacts-form-relationship-block contacts-form-wide">
          <div className="contacts-relationship-options contacts-relationship-options--compact">
            <label className={form.isCustomer ? 'is-selected' : ''}>
              <input type="checkbox" checked={form.isCustomer} disabled={forceCustomer} onChange={e => f('isCustomer')(e.target.checked)} />
              <span><strong>Customer</strong><small>Buys from us</small></span>
            </label>
            <label className={form.isVendor ? 'is-selected' : ''}>
              <input type="checkbox" checked={form.isVendor} disabled={forceVendor} onChange={e => { f('isVendor')(e.target.checked); if (e.target.checked) setActiveDetailsTab('payment') }} />
              <span><strong>Vendor</strong><small>Supplies to us</small></span>
            </label>
          </div>
        </div>

        <div className="contacts-form-wide">
          <Field label={form.type === 'company' ? 'Company name' : 'Full name'} required id="contact-name" error={fieldErrors.name}>
            <Input value={form.name} onChange={f('name')} placeholder={form.type === 'company' ? 'e.g. Acme Corporation Ltd' : 'e.g. John Kamau Mwangi'} autoFocus />
          </Field>
        </div>
        {form.type === 'individual' && (
          <>
            <Field label="Works at">
              <Select
                value={form.companyId ?? ''}
                onChange={f('companyId')}
                options={[{ value: '', label: 'No company' }, ...companies.map(c => ({ value: c.id, label: c.name }))]}
              />
            </Field>
            <Field label="Job title">
              <Input value={form.jobTitle ?? ''} onChange={f('jobTitle')} placeholder="e.g. IT Manager" />
            </Field>
          </>
        )}
        <Field label="Phone">
          <Input value={form.phone} onChange={f('phone')} type="tel" placeholder="0712 345 678" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
        </Field>
        <Field label="Email">
          <Input value={form.email} onChange={f('email')} type="email" placeholder={form.type === 'company' ? 'info@company.co.ke' : 'name@example.com'} maxLength={100} />
        </Field>
        <div className="contacts-form-wide">
          <Field label="KRA PIN" hint={kraPinWarning(form.vatNumber, form.type) ?? 'Shown on invoices and tax documents'}>
            <Input value={form.vatNumber ?? ''} onChange={f('vatNumber')} placeholder={form.type === 'company' ? 'e.g. P051234567X' : 'e.g. A012345678B'} />
          </Field>
        </div>

        <section className="contacts-details-tabs">
          <nav className="contacts-details-tabs__nav" aria-label="More details">
            {detailsTabs.map(([id, label]) => (
              <button key={id} type="button" className={activeDetailsTab === id ? 'is-active' : ''} onClick={() => setActiveDetailsTab(id)}>
                {label}{id === 'persons' && contactPersons.length > 0 ? <span>{contactPersons.length}</span> : null}
              </button>
            ))}
          </nav>

          <div className="contacts-details-tabs__panel">
            {activeDetailsTab === 'payment' && (
              <div className="contacts-form-optional__grid">
                <div className="contacts-form-wide">
                  <div className="contacts-paymethod" role="radiogroup" aria-label="How we pay them">
                    {([['bank', 'Bank'], ['paybill', 'M-Pesa Paybill'], ['till', 'M-Pesa Till'], ['mpesa', 'Send money']] as const).map(([m, label]) => (
                      <button key={m} type="button" role="radio" aria-checked={payMethod === m} className={payMethod === m ? 'is-active' : ''} onClick={() => setPayMethod(m)}>{label}</button>
                    ))}
                  </div>
                </div>
                {payMethod === 'bank' && (
                  <>
                    <Field label="Bank"><Input value={form.bankName ?? ''} onChange={f('bankName')} placeholder="e.g. Equity Bank" /></Field>
                    <Field label="Branch"><Input value={form.bankBranch ?? ''} onChange={f('bankBranch')} placeholder="e.g. Moi Avenue" /></Field>
                    <div className="contacts-form-wide"><Field label="Account number"><Input value={form.bankAccount ?? ''} onChange={f('bankAccount')} placeholder="e.g. 0170291234567" /></Field></div>
                  </>
                )}
                {payMethod === 'paybill' && (
                  <>
                    <Field label="Paybill number"><Input value={form.bankBranch ?? ''} onChange={f('bankBranch')} placeholder="e.g. 247247" /></Field>
                    <Field label="Account number"><Input value={form.bankAccount ?? ''} onChange={f('bankAccount')} placeholder="e.g. 0712345678" /></Field>
                  </>
                )}
                {payMethod === 'till' && (
                  <div className="contacts-form-wide"><Field label="Till number"><Input value={form.bankAccount ?? ''} onChange={f('bankAccount')} placeholder="e.g. 5123456" /></Field></div>
                )}
                {payMethod === 'mpesa' && (
                  <div className="contacts-form-wide"><Field label="M-Pesa number" hint="Registered name should match the vendor"><Input value={form.bankAccount ?? ''} onChange={f('bankAccount')} type="tel" placeholder="e.g. 0712 345 678" /></Field></div>
                )}
              </div>
            )}

            {activeDetailsTab === 'terms' && (
              <div className="contacts-form-optional__grid">
                <Field label="Payment terms" required={canSetCreditTerms && form.isCustomer} id="contact-paymentTermsDays" error={fieldErrors.paymentTermsDays}
                  hint={!canSetCreditTerms ? creditTermsHint : form.isCustomer ? 'Days they have to pay our invoices' : 'Days we have to pay their bills'}>
                  <Select disabled={!canSetCreditTerms} value={paymentTermsValue} onChange={v => f('paymentTermsDays')(v === '' ? undefined : Number(v))} options={paymentTermsOptions} />
                </Field>
                {form.isCustomer && form.type === 'company' && (
                  <Field label="Credit limit (KES)" required={canSetCreditTerms} id="contact-creditLimit" error={fieldErrors.creditLimit} hint={canSetCreditTerms ? '0 for none' : creditTermsHint}>
                    <Input type="number" disabled={!canSetCreditTerms} value={creditLimitText} onChange={v => { setCreditLimitText(String(v)); if (fieldErrors.creditLimit) setFieldErrors(prev => ({ ...prev, creditLimit: undefined })) }} placeholder="0" />
                  </Field>
                )}
                {form.type === 'individual' && (
                  <Field label="National ID / passport" hint="Only when identification is needed">
                    <Input value={form.idNumber ?? ''} onChange={f('idNumber')} placeholder="ID or passport number" />
                  </Field>
                )}
              </div>
            )}

            {activeDetailsTab === 'address' && (
              <div className="contacts-form-optional__grid">
                <div className="contacts-form-wide"><Field label="Physical address"><Input value={form.address} onChange={f('address')} placeholder="Building, street, area" /></Field></div>
                <Field label="Town / city"><Input value={form.city ?? ''} onChange={f('city')} placeholder="e.g. Nairobi" /></Field>
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
              <Field label="Notes" hint="For your team only">
                <Textarea value={form.notes ?? ''} onChange={f('notes')} placeholder="Preferences, context…" rows={5} />
              </Field>
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
