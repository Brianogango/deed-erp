'use client'
import { useId, useMemo, useState } from 'react'

export type SerialOption = {
  id: string
  serial: string
  barcode?: string
  productName?: string
  location: string
  status: string
}

/**
 * Searchable multi-select for assigning serial numbers.
 * Checkbox semantics keep it keyboard accessible; selection is capped at
 * `maxSelectable` when provided.
 */
export function SerialMultiSelect({
  serials,
  selectedIds,
  onChange,
  maxSelectable,
  placeholder = 'Search serial or barcode…',
}: {
  serials: SerialOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  maxSelectable?: number
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return serials
    return serials.filter(s =>
      s.serial.toLowerCase().includes(q) || (s.barcode ?? '').toLowerCase().includes(q),
    )
  }, [serials, query])

  const atMax = maxSelectable !== undefined && selectedIds.length >= maxSelectable

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter(x => x !== id))
    else if (!atMax) onChange([...selectedIds, id])
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label htmlFor={searchId} className="sr-only">Search serials</label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1, minWidth: 0, fontSize: 11, padding: '5px 10px',
            border: '1px solid var(--border-lt)', borderRadius: 8, background: 'var(--bg-surface, #fff)',
          }}
        />
        <span aria-live="polite" style={{ fontSize: 10, fontWeight: 700, color: atMax ? 'var(--success, #059669)' : 'var(--text-3, #64748B)', whiteSpace: 'nowrap' }}>
          {selectedIds.length}{maxSelectable !== undefined ? ` of ${maxSelectable}` : ''} selected
        </span>
      </div>
      <div
        role="group"
        aria-label="Serial numbers"
        style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid var(--border-lt)', borderRadius: 8, marginTop: 4 }}
      >
        {filtered.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-4)', padding: '6px 12px', margin: 0 }}>No serials found</p>
        )}
        {filtered.map(s => {
          const checked = selectedIds.includes(s.id)
          const disabled = !checked && atMax
          return (
            <label
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', fontSize: 11,
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
                background: checked ? '#E8F3FA' : 'transparent', borderBottom: '1px solid var(--bg-muted)',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(s.id)}
                style={{ accentColor: 'var(--accent-cyan, #00B0D7)' }}
              />
              <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--navy)' }}>
                {s.serial}{s.barcode && s.barcode !== s.serial ? ` (${s.barcode})` : ''}
              </span>
              {s.productName && <span style={{ fontSize: 9, color: 'var(--text-3, #64748B)' }}>{s.productName}</span>}
              <span style={{ fontSize: 9, color: 'var(--text-4)' }}>{s.status} · {s.location}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
