'use client'

import { useMemo, useState } from 'react'
import { Field, Input, Modal, SearchPicker } from '@/components/ui'
import { useAfterSalesStore } from '@/lib/store'

type ContactItem = { id: string; name: string; phone?: string; email?: string; isCustomer?: boolean }

/**
 * Customer search + selected card + quick-register for Trade-in (buyback / exchange).
 */
export function CustomerPickerField({
  customerId,
  customerName,
  onSelect,
  onClear,
}: {
  customerId: string
  customerName: string
  onSelect: (id: string, name: string) => void
  onClear: () => void
}) {
  const { contacts, addContact, showToast } = useAfterSalesStore()

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [registering, setRegistering] = useState(false)

  const customerItems = useMemo(() => {
    const list = (contacts as ContactItem[])
      .filter(c => c.isCustomer !== false)
      .map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        isCustomer: c.isCustomer,
      }))
    return list.sort((a, b) => {
      const ac = a.isCustomer ? 0 : 1
      const bc = b.isCustomer ? 0 : 1
      if (ac !== bc) return ac - bc
      return a.name.localeCompare(b.name)
    })
  }, [contacts])

  const selected = customerItems.find(c => c.id === customerId)

  function openCreate(seed = '') {
    setCreateName(seed.trim())
    setCreateEmail('')
    setCreatePhone('')
    setShowCreate(true)
  }

  async function register() {
    if (!createName.trim() || !createEmail.trim() || !createPhone.trim()) {
      showToast('Please fill in name, email and phone', 'error')
      return
    }
    setRegistering(true)
    try {
      const contact = await addContact({
        type: 'individual',
        name: createName.trim(),
        email: createEmail.trim(),
        phone: createPhone.trim(),
        address: '',
        isCustomer: true,
        isVendor: false,
        tags: [],
      })
      onSelect(contact.id, contact.name)
      setShowCreate(false)
    } catch {
      /* toast from addContact */
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div>
      <SearchPicker
        label=""
        placeholder="Search customer…"
        items={customerItems}
        selectedLabel={customerName || undefined}
        formatSelected={c => c.name}
        onSelect={c => onSelect(c.id, c.name)}
        onCreateNew={q => openCreate(q)}
        createNewLabels={{ title: 'Register', subtitle: 'Add this customer to the system' }}
        renderItem={c => (
          <div>
            <p className="font-medium text-xs text-t1">{c.name}</p>
            <p className="text-[10px] text-t3">{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact info'}</p>
          </div>
        )}
      />
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Customer not in list?</span>
        <button
          type="button"
          className="text-[10px] underline cursor-pointer"
          style={{ color: 'var(--accent)' }}
          onClick={() => openCreate()}
        >
          + Register new customer
        </button>
      </div>
      {customerId && (
        <div
          className="rounded-xl border px-3 py-2 mt-2 flex items-center justify-between gap-3"
          style={{ borderColor: '#BFDBFE', background: '#EFF6FF' }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest font-black" style={{ color: '#1D4ED8' }}>Selected customer</p>
            <p className="text-sm font-extrabold mt-0.5" style={{ color: '#0F172A' }}>{customerName || selected?.name}</p>
            {(selected?.phone || selected?.email) && (
              <p className="text-[10px] mt-0.5" style={{ color: '#1D4ED8' }}>
                {[selected.phone, selected.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button type="button" className="text-xs font-bold cursor-pointer" style={{ color: '#1D4ED8' }} onClick={onClear}>
            Clear
          </button>
        </div>
      )}

      {showCreate && (
        <Modal title="Quick Register Customer" onClose={() => setShowCreate(false)} width={460}>
          <div className="flex flex-col gap-3">
            <Field label="Customer Name" required>
              <Input value={createName} onChange={setCreateName} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email" required>
                <Input type="email" value={createEmail} onChange={setCreateEmail} />
              </Field>
              <Field label="Phone" required>
                <Input type="tel" value={createPhone} onChange={setCreatePhone} />
              </Field>
            </div>
            <div className="flex gap-2 justify-end pt-3 border-t border-[var(--border-lt)]">
              <button className="btn-secondary text-[11px]" onClick={() => setShowCreate(false)} disabled={registering}>Cancel</button>
              <button className="btn-primary text-[11px]" onClick={register} disabled={registering}>
                {registering ? 'Registering…' : 'Register & Select'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
