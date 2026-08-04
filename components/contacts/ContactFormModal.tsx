'use client'

import { useMemo, useState } from 'react'
import type { Contact } from '@/lib/store'
import { useCrmStore } from '@/lib/store'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'
import { Fa, faBuilding, faUser } from '@/components/icons'

export const CONTACT_INDUSTRIES = [
  'Financial Services', 'Telecommunications', 'Electronics', 'IT Services',
  'Healthcare', 'Education', 'Retail', 'Manufacturing', 'Construction',
  'Real Estate', 'Hospitality', 'Transport & Logistics', 'Agriculture',
  'Government', 'NGO / Non-profit', 'Media & Entertainment', 'Other',
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

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="col-span-2 flex items-center gap-2 mt-1">
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-3)' }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--border-lt)' }} />
    </div>
  )
}

type Props = {
  /** Existing contact id when editing; omit for create. */
  editId?: string | null
  /** Initial form values (create or edit). */
  initial: ContactFormValues
  onClose: () => void
  /** Called after a successful create/update with the saved contact. */
  onSaved: (contact: Contact) => void
  /** Force customer flag (e.g. from Sales quote flow). */
  forceCustomer?: boolean
}

/**
 * Full Contacts-module create/edit form — shared by Contacts and Sales quote creation.
 */
export default function ContactFormModal({
  editId = null,
  initial,
  onClose,
  onSaved,
  forceCustomer = false,
}: Props) {
  const { contacts, addContact, updateContact } = useCrmStore()
  const [form, setForm] = useState<ContactFormValues>(() => ({
    ...initial,
    ...(forceCustomer ? { isCustomer: true } : {}),
  }))
  const [saving, setSaving] = useState(false)

  const companies = useMemo(
    () => contacts.filter(c => c.type === 'company'),
    [contacts],
  )

  const f = (k: keyof ContactFormValues) => (v: unknown) => {
    setForm(prev => ({ ...prev, [k]: v }))
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
      isVendor: form.isVendor,
      tags: form.tags,
    }
    setForm(type === 'company'
      ? blankCompanyContact(shared)
      : blankIndividualContact(shared))
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload: ContactFormValues = {
        ...form,
        name: form.name.trim(),
        ...(forceCustomer ? { isCustomer: true } : {}),
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
    <Modal
      title={editId ? `Edit — ${form.name || 'Contact'}` : form.type === 'company' ? 'New Company' : 'New Individual'}
      width={680}
      onClose={onClose}
    >
      {!editId && (
        <div className="grid grid-cols-2 gap-2 mb-1">
          {(['company', 'individual'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => switchType(t)}
              className="py-2.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{
                background: form.type === t ? '#E8F3FA' : 'var(--bg-surface)',
                color: form.type === t ? 'var(--navy)' : 'var(--text-3)',
                border: form.type === t ? '1px solid #A8D4E8' : '1px solid var(--border-lt)',
                fontWeight: form.type === t ? 600 : 400,
              }}
            >
              {t === 'company'
                ? <><Fa icon={faBuilding} /> Company / Organisation</>
                : <><Fa icon={faUser} /> Individual / Person</>}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <SectionLabel label="Basic Information" />

        {form.type === 'company' ? (
          <>
            <div className="sm:col-span-2">
              <Field label="Company Name" required>
                <Input value={form.name} onChange={f('name')} placeholder="e.g. Acme Corporation Ltd" autoFocus />
              </Field>
            </div>
            <Field label="Trading Name">
              <Input value={form.tradingName ?? ''} onChange={f('tradingName')} placeholder="e.g. Acme (if different)" />
            </Field>
            <Field label="Industry">
              <Select
                value={form.industry ?? ''}
                onChange={f('industry')}
                options={[{ value: '', label: 'Select industry...' }, ...CONTACT_INDUSTRIES.map(i => ({ value: i, label: i }))]}
              />
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
            <div className="sm:col-span-2">
              <Field label="Full Name" required>
                <Input value={form.name} onChange={f('name')} placeholder="e.g. John Kamau Mwangi" autoFocus />
              </Field>
            </div>
            <Field label="Job Title">
              <Input value={form.jobTitle ?? ''} onChange={f('jobTitle')} placeholder="e.g. IT Manager" />
            </Field>
            <Field label="Linked Company">
              <Select
                value={form.companyId ?? ''}
                onChange={f('companyId')}
                options={[{ value: '', label: 'No company / Independent' }, ...companies.map(c => ({ value: c.id, label: c.name }))]}
              />
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

        <div className="sm:col-span-2">
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

        <div className="sm:col-span-2 flex gap-6 py-1">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.isCustomer}
              disabled={forceCustomer}
              onChange={e => f('isCustomer')(e.target.checked)}
              style={{ accentColor: 'var(--navy)', width: 14, height: 14 }}
            />
            <span className="text-t1">Is a Customer</span>
            <span className="text-t3 text-[10px]">(buys from us)</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.isVendor}
              onChange={e => f('isVendor')(e.target.checked)}
              style={{ accentColor: 'var(--navy)', width: 14, height: 14 }}
            />
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
        <div className="sm:col-span-2">
          <Field label="Branch"><Input value={form.bankBranch ?? ''} onChange={f('bankBranch')} placeholder="e.g. Westlands Branch" /></Field>
        </div>

        <SectionLabel label="Notes" />

        <div className="sm:col-span-2">
          <Textarea value={form.notes ?? ''} onChange={f('notes')} placeholder="Any additional notes about this contact..." rows={3} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 justify-end pt-3">
        <button type="button" className="btn-outline w-full sm:w-auto" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => void save()} disabled={!form.name.trim() || saving}>
          {saving ? 'Saving…' : editId ? 'Save Changes' : form.type === 'company' ? 'Create Company' : 'Create Contact'}
        </button>
      </div>
    </Modal>
  )
}
