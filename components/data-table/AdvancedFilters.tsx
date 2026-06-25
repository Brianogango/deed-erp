'use client'

import { SlidePanel } from '@/components/ui'
import type { ColumnDef } from '@/lib/data-table/types'

export type FilterOperator = 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'date_range' | 'number_range'

export interface FilterRule {
  columnKey: string
  operator: FilterOperator
  value: string
  value2?: string // range upper bound
}

interface AdvancedFiltersProps<T> {
  columns: ColumnDef<T>[]
  rules: FilterRule[]
  onChange: (rules: FilterRule[]) => void
  onClose: () => void
}

// v1: filter rows are implicitly AND-ed together (the common case for every
// real table in this audit). OR-groups can be layered on top of this same
// FilterRule[] shape later without changing the storage format.
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'Contains',
  equals: 'Equals',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  date_range: 'Date range',
  number_range: 'Number range',
}

export default function AdvancedFilters<T>({ columns, rules, onChange, onClose }: AdvancedFiltersProps<T>) {
  function addRule() {
    const first = columns[0]
    if (!first) return
    onChange([...rules, { columnKey: first.key, operator: 'contains', value: '' }])
  }

  function updateRule(index: number, patch: Partial<FilterRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index))
  }

  return (
    <SlidePanel title="Advanced filters" subtitle="All conditions must match" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        {rules.length === 0 && (
          <p className="text-xs text-[var(--text-3)]">No filters yet. Add a condition below.</p>
        )}
        {rules.map((rule, index) => {
          const isRange = rule.operator === 'date_range' || rule.operator === 'number_range'
          return (
            <div key={index} className="rounded-xl border border-[var(--border-lt)] p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <select
                  className="form-select text-xs flex-1"
                  value={rule.columnKey}
                  onChange={e => updateRule(index, { columnKey: e.target.value })}
                >
                  {columns.map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="text-[var(--text-4)] hover:text-[var(--danger-text)] text-xs px-1.5"
                  aria-label="Remove filter"
                >
                  ✕
                </button>
              </div>
              <select
                className="form-select text-xs"
                value={rule.operator}
                onChange={e => updateRule(index, { operator: e.target.value as FilterOperator })}
              >
                {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <input
                  className="form-input text-xs flex-1"
                  type={rule.operator === 'date_range' ? 'date' : rule.operator === 'number_range' ? 'number' : 'text'}
                  value={rule.value}
                  onChange={e => updateRule(index, { value: e.target.value })}
                  placeholder={isRange ? 'From' : 'Value'}
                />
                {isRange && (
                  <input
                    className="form-input text-xs flex-1"
                    type={rule.operator === 'date_range' ? 'date' : 'number'}
                    value={rule.value2 ?? ''}
                    onChange={e => updateRule(index, { value2: e.target.value })}
                    placeholder="To"
                  />
                )}
              </div>
            </div>
          )
        })}
        <button type="button" onClick={addRule} className="btn-outline text-xs self-start">
          + Add condition
        </button>
      </div>
    </SlidePanel>
  )
}

// Applies a rule set to one row. Exported so DataTable's client-side
// filtering and any future server-side translation share one definition.
export function applyFilterRules<T>(row: T, columns: ColumnDef<T>[], rules: FilterRule[]): boolean {
  return rules.every(rule => {
    const col = columns.find(c => c.key === rule.columnKey)
    if (!col) return true
    const raw = col.exportValue ? col.exportValue(row) : String(col.render(row) ?? '')
    const text = String(raw ?? '').toLowerCase()

    switch (rule.operator) {
      case 'contains': return text.includes(rule.value.toLowerCase())
      case 'equals': return text === rule.value.toLowerCase()
      case 'starts_with': return text.startsWith(rule.value.toLowerCase())
      case 'ends_with': return text.endsWith(rule.value.toLowerCase())
      case 'number_range': {
        const num = Number(raw)
        const min = rule.value ? Number(rule.value) : -Infinity
        const max = rule.value2 ? Number(rule.value2) : Infinity
        return Number.isFinite(num) && num >= min && num <= max
      }
      case 'date_range': {
        const date = new Date(String(raw)).getTime()
        const min = rule.value ? new Date(rule.value).getTime() : -Infinity
        const max = rule.value2 ? new Date(rule.value2).getTime() : Infinity
        return Number.isFinite(date) && date >= min && date <= max
      }
      default: return true
    }
  })
}
