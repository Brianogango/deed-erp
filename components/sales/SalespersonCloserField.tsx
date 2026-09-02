'use client'

import { useEffect, useMemo, useState } from 'react'
import { SalesDocField } from '@/components/modules/sales/workbench'
import { Field } from '@/components/ui'
import type { CommissionCloserOption } from '@/lib/sales/commission-closer'

export function SalespersonCloserField({
  valueId,
  valueName,
  createdByName: _createdByName,
  disabled,
  onChange,
  variant = 'sales',
  id,
}: {
  valueId?: string
  valueName?: string
  createdByName?: string
  disabled?: boolean
  onChange: (id: string, name: string) => void
  variant?: 'sales' | 'compact'
  id?: string
}) {
  const [closers, setClosers] = useState<CommissionCloserOption[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/salespeople')
      .then(res => res.json())
      .then(body => {
        if (cancelled || !Array.isArray(body?.salespeople)) return
        setClosers(body.salespeople)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const options = useMemo(() => {
    const list = [...closers]
    if (valueId && !list.some(c => c.id === valueId)) {
      list.unshift({
        id: valueId,
        name: valueName || 'Current salesperson',
        role: '',
        hasEmployee: true,
      })
    }
    return list
  }, [closers, valueId, valueName])

  const compact = variant === 'compact'
  const fieldId = id || (compact ? 'pos-closer' : 'sale-closer')

  const select = (
    <select
      id={compact ? undefined : fieldId}
      className={compact ? 'form-input text-xs' : undefined}
      aria-label="Person who closed this sale"
      disabled={disabled}
      value={valueId || ''}
      onChange={e => {
        const next = options.find(c => c.id === e.target.value)
        if (next) onChange(next.id, next.name)
      }}
    >
      {!valueId && <option value="">Select salesperson…</option>}
      {options.map(c => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )

  if (compact) {
    return (
      <Field label="Salesperson" id={fieldId}>
        {select}
      </Field>
    )
  }

  return (
    <SalesDocField label="Salesperson" htmlFor={fieldId}>
      {select}
    </SalesDocField>
  )
}
