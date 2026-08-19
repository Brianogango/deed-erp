'use client'

import { useEffect, useMemo, useState } from 'react'
import { SalesDocField } from '@/components/modules/sales/workbench'
import {
  commissionCloserHint,
  type CommissionCloserOption,
} from '@/lib/sales/commission-closer'

export function SalespersonCloserField({
  valueId,
  valueName,
  createdByName,
  disabled,
  onChange,
}: {
  valueId?: string
  valueName?: string
  createdByName?: string
  disabled?: boolean
  onChange: (id: string, name: string) => void
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

  const selected = options.find(c => c.id === valueId) ?? null
  const hint = commissionCloserHint({ closer: selected, createdByName })

  return (
    <SalesDocField label="Salesperson (commission)" htmlFor="sale-closer">
      <select
        id="sale-closer"
        aria-label="Person who closed this sale"
        disabled={disabled}
        value={valueId || ''}
        onChange={e => {
          const next = options.find(c => c.id === e.target.value)
          if (next) onChange(next.id, next.name)
        }}
      >
        {!valueId && <option value="">Select who closed this sale…</option>}
        {options.map(c => (
          <option key={c.id} value={c.id}>
            {c.hasEmployee ? c.name : `${c.name} (no HR employee — commission will not post)`}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-[var(--sp-text-3)] mt-1 m-0">{hint}</p>
    </SalesDocField>
  )
}
