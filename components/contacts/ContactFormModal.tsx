'use client'

import { useMemo, useState } from 'react'
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
    paymentTermsDays: 30, creditLimit: 0,
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
    paymentTermsDays: initial.paymentTermsDays ?? 30,
    ...(forceCustomer ? { isCustomer: true } : {}),
    ...(forceVendor ? { isVendor: true } : {}),
  }))
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name', string>>>({})

  const companies = useMemo(
    () => contacts.filter(c => c.type === 'company'),
    [contacts],
  )

  const paymentTermsValue = String(form.paymentTermsDays ?? 30)
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
    const shared = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      mobile: form.mobile,
      address: form.address,
      city: form.city,
      country: form.country,
      vatNumber: form.vatNumber,
      notes: form.notes,
      isCustomer: forceCustomer ? true : form.isCustomer,
      isVendor: forceVendor ? true : form.isVendor,
      tags: form.tags,
      paymentTermsDays: form.paymentTermsDays ?? 30,
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
      const contact = editId
        ? await updateContact(editId, payload)
        : await addContact(payload)
      onSaved(contact as Contact)
    } catch {
      // store helpers already toast
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlidePanel
      title={editId ? `Edit ${form.name || 'contact'}` : 'New contact'}
      subtitle={editId ? 'Update contact information' : 'Capture essentials first. Add more details only when needed.'}
      onClose={onClose}
    >
      <div className={`contacts-form-sheet contacts-form-sheet--${form.type}`}>
      {!editId && (
        <div className="contacts-type-switch" role="group" aria-label="Contact type">
          {(['individual', 'company'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => switchType(t)}
              className={form.type === t ? 'is-active' : ''}
              aria-pressed={form.type === t}
            >
              {t === 'individual'
                ? <><Fa icon={faUser} /> <span><strong>Individual</strong><small>Person / contact</small></span></>
                : <><Fa icon={faBuilding} /> <span><strong>Company</strong><small>Organisation / business</small></span></>}
            </button>
          ))}
        </div>
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

        <details className="contacts-form-optional contacts-form-more" defaultOpen={Boolean(editId)}>
          <summary>
            <div>
              <strong>More details</strong>
              <small>
                {form.type === 'company'
                  ? 'Trading name, registration, address, terms, banking and notes'
                  : 'ID, KRA PIN, address, terms, banking and notes'}
              </small>
            </div>
            <span>Optional</span>
          </summary>

          <div className="contacts-form-more__content">
            {form.type === 'company' ? (
              <section className="contacts-form-more__section">
                <div className="contacts-form-more__heading">
                  <strong>Company details</strong>
                  <span>Additional legal and contact information</span>
                </div>
                <div className="contacts-form-optional__grid">
                  <Field label="Trading Name">
                    <Input value={form.tradingName ?? ''} onChange={f('tradingName')} placeholder="e.g. Acme (if different)" />
                  </Field>
                  <Field label="Registration Number">
                    <Input value={form.registrationNumber ?? ''} onChange={f('registrationNumber')} placeholder="e.g. CPR/2024/1234" />
                  </Field>
                  <Field label="Mobile">
                    <Input value={form.mobile ?? ''} onChange={f('mobile')} type="tel" placeholder="+254 700 000 000" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
                  </Field>
                  <Field label="Website">
                    <Input value={form.website ?? ''} onChange={f('website')} placeholder="https://example.com" />
                  </Field>
                </div>
              </section>
            ) : (
              <section className="contacts-form-more__section">
                <div className="contacts-form-more__heading">
                  <strong>Identity & tax</strong>
                  <span>Only add when required</span>
                </div>
                <div className="contacts-form-optional__grid">
                  <Field label="National ID / Passport No.">
                    <Input value={form.idNumber ?? ''} onChange={f('idNumber')} placeholder="e.g. 12345678" />
                  </Field>
                  <Field label="KRA PIN">
                    <Input value={form.vatNumber ?? ''} onChange={f('vatNumber')} placeholder="e.g. A123456789B" />
                  </Field>
                </div>
              </section>
            )}

            <section className="contacts-form-more__section">
              <div className="contacts-form-more__heading">
                <strong>Address</strong>
                <span>Physical and location details</span>
              </div>
              <div className="contacts-form-optional__grid">
                <div className="contacts-form-wide">
                  <Field label="Physical Address">
                    <Input value={form.address} onChange={f('address')} placeholder="Street / Building, Area" />
                  </Field>
                </div>
                {form.type === 'company' && (
                  <Field label="Postal Address">
                    <Input value={form.postalAddress ?? ''} onChange={f('postalAddress')} placeholder="P.O. Box 00000-00100" />
                  </Field>
                )}
                <Field label="City">
                  <Input value={form.city ?? ''} onChange={f('city')} placeholder="e.g. Nairobi" />
                </Field>
                <Field label="Country">
                  <Input value={form.country ?? ''} onChange={f('country')} placeholder="e.g. Kenya" />
                </Field>
              </div>
            </section>

            <section className="contacts-form-more__section">
              <div className="contacts-form-more__heading">
                <strong>Commercial settings</strong>
                <span>Invoice terms and account controls</span>
              </div>
              <div className="contacts-form-optional__grid">
                <Field
                  label="Payment Terms (days)"
                  hint="Determines when this customer's invoices are marked overdue."
                >
                  <Select
                    value={paymentTermsValue}
                    onChange={v => f('paymentTermsDays')(Number(v))}
                    options={paymentTermsOptions}
                  />
                </Field>
                <Field label="Credit Limit (KES)">
                  <Input value={String(form.creditLimit ?? '')} onChange={v => f('creditLimit')(Number(v) || 0)} placeholder="e.g. 500000" />
                </Field>
              </div>
            </section>

            <section className="contacts-form-more__section">
              <div className="contacts-form-more__heading">
                <strong>Banking details</strong>
                <span>Optional settlement information</span>
              </div>
              <div className="contacts-form-optional__grid">
                <Field label="Bank Name">
                  <Input value={form.bankName ?? ''} onChange={f('bankName')} placeholder="e.g. Equity Bank" />
                </Field>
                <Field label="Account Number">
                  <Input value={form.bankAccount ?? ''} onChange={f('bankAccount')} placeholder="e.g. 0110123456" />
                </Field>
                <div className="contacts-form-wide">
                  <Field label="Branch">
                    <Input value={form.bankBranch ?? ''} onChange={f('bankBranch')} placeholder="e.g. Westlands Branch" />
                  </Field>
                </div>
              </div>
            </section>

            <section className="contacts-form-more__section contacts-form-more__section--last">
              <div className="contacts-form-more__heading">
                <strong>Internal notes</strong>
                <span>Preferences, context or other useful information</span>
              </div>
              <div className="contacts-form-optional__body">
                <Textarea value={form.notes ?? ''} onChange={f('notes')} placeholder="Add internal notes..." rows={3} />
              </div>
            </section>
          </div>
        </details>
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
