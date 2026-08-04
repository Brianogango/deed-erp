'use client'

import { useMemo, useState } from 'react'
import { SearchPicker } from '@/components/ui'
import { useAfterSalesStore } from '@/lib/store'
import ContactFormModal, { blankIndividualContact } from '@/components/contacts/ContactFormModal'

type ContactItem = { id: string; name: string; phone?: string; email?: string; isCustomer?: boolean }

/**
 * Customer search + selected card + full Contacts create form for Trade-in (buyback / exchange).
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
  const { contacts } = useAfterSalesStore()

  const [showCreate, setShowCreate] = useState(false)
  const [createSeed, setCreateSeed] = useState('')
  const [formKey, setFormKey] = useState(0)

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
    setCreateSeed(seed.trim())
    setFormKey(k => k + 1)
    setShowCreate(true)
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
        createNewLabels={{ title: 'Create contact', subtitle: 'Open the full Contacts form' }}
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
          + Create new contact
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
        <ContactFormModal
          key={formKey}
          forceCustomer
          initial={blankIndividualContact({ name: createSeed })}
          onClose={() => {
            setShowCreate(false)
            setCreateSeed('')
          }}
          onSaved={(contact) => {
            onSelect(contact.id, contact.name)
            setShowCreate(false)
            setCreateSeed('')
          }}
        />
      )}
    </div>
  )
}
