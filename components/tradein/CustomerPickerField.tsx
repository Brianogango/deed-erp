'use client'

import { useMemo, useState } from 'react'
import { SearchPicker } from '@/components/ui'
import { useAfterSalesStore } from '@/lib/store'
import ContactFormModal, { blankIndividualContact } from '@/components/contacts/ContactFormModal'
import { customerPickerItems } from '@/lib/contact-search'

/**
 * Customer search + selected card + full Contacts create form.
 * POS uses compact mode so the checkout rail stays short.
 */
export function CustomerPickerField({
  customerId,
  customerName,
  onSelect,
  onClear,
  compact = false,
  allowWalkIn = false,
}: {
  customerId: string
  customerName: string
  onSelect: (id: string, name: string) => void
  onClear: () => void
  compact?: boolean
  allowWalkIn?: boolean
}) {
  const { contacts } = useAfterSalesStore()

  const [showCreate, setShowCreate] = useState(false)
  const [createSeed, setCreateSeed] = useState('')
  const [formKey, setFormKey] = useState(0)

  const customerItems = useMemo(
    () => customerPickerItems(contacts),
    [contacts],
  )

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
        placeholder={allowWalkIn ? 'Search customer or leave as walk-in…' : 'Search customer…'}
        items={customerItems}
        selectedLabel={customerName || undefined}
        formatSelected={c => c.name}
        onSelect={c => onSelect(c.id, c.name)}
        onCreateNew={q => openCreate(q)}
        createNewLabels={{ title: 'Create contact', subtitle: 'Open the full Contacts form' }}
        inputClassName={compact ? 'text-xs' : undefined}
        renderItem={c => (
          <div>
            <p className="font-medium text-xs text-t1">{c.name}</p>
            <p className="text-[10px] text-t3">{[c.phone, c.mobile, c.email].filter(Boolean).join(' · ') || 'No contact info'}</p>
          </div>
        )}
      />
      {!compact && (
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
      )}
      {customerId && !compact && (
        <div
          className="rounded-xl border px-3 py-2 mt-2 flex items-center justify-between gap-3"
          style={{ borderColor: 'color-mix(in srgb, var(--info) 35%, transparent)', background: 'var(--info-bg)' }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest font-black" style={{ color: 'var(--info-text)' }}>Selected customer</p>
            <p className="text-sm font-extrabold mt-0.5" style={{ color: 'var(--text-1)' }}>{customerName || selected?.name}</p>
            {(selected?.phone || selected?.email) && (
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--info-text)' }}>
                {[selected.phone, selected.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button type="button" className="text-xs font-bold cursor-pointer" style={{ color: 'var(--info-text)' }} onClick={onClear}>
            Clear
          </button>
        </div>
      )}
      {customerId && compact && (
        <div className="flex items-center justify-between gap-2 mt-1">
          <p className="text-[10px] text-t3 truncate">
            {[selected?.phone, selected?.mobile, selected?.email].filter(Boolean).join(' · ') || 'Saved contact'}
          </p>
          <button
            type="button"
            className="text-[10px] font-semibold shrink-0"
            style={{ color: 'var(--accent)' }}
            onClick={onClear}
          >
            {allowWalkIn ? 'Use walk-in' : 'Clear'}
          </button>
        </div>
      )}
      {compact && !customerId && (
        <button
          type="button"
          className="text-[10px] mt-1 underline cursor-pointer"
          style={{ color: 'var(--accent)' }}
          onClick={() => openCreate()}
        >
          + Create contact
        </button>
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
