'use client'

import type { PrimaryFilterConfig } from '@/lib/data-table/toolbar-types'

interface FilterSelectProps {
  filter: PrimaryFilterConfig
  className?: string
}

export default function FilterSelect({ filter, className = '' }: FilterSelectProps) {
  const placeholder = filter.placeholder ?? filter.label
  return (
    <select
      className={`dt-toolbar-select ${className}`.trim()}
      value={filter.value}
      onChange={e => filter.onChange(e.target.value)}
      aria-label={filter.label}
      title={filter.label}
    >
      {filter.options.some(o => o.value === (filter.allValue ?? 'all')) ? null : (
        <option value={filter.allValue ?? 'all'}>{placeholder}</option>
      )}
      {filter.options.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
