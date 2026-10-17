'use client'

import React from 'react'
import {
  CONDITION_OPTIONS,
  type ConditionFilter,
  type LayoutPreset,
} from '@/lib/inventory/view-prefs'

interface Option<V extends string> { value: V; label: string; hint?: string }

interface InventoryViewBarProps {
  /** "Show" — which products appear (catalog only). */
  show?: { value: string; options: Option<string>[]; onChange: (v: string) => void }
  condition?: { value: ConditionFilter; onChange: (v: ConditionFilter) => void }
  sort?: { value: string; options: Option<string>[]; onChange: (v: string) => void }
  /** Layout presets that switch the table's columns. */
  layout?: { value: string; presets: LayoutPreset[]; onChange: (preset: LayoutPreset) => void }
  /** Shown when any choice differs from the default. */
  onReset?: () => void
  isCustomised?: boolean
}

function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V
  options: Option<V>[]
  onChange: (v: V) => void
}) {
  return (
    <div className="inventory-view-group" role="radiogroup" aria-label={label}>
      <span className="inventory-view-label">{label}</span>
      <div className="inventory-view-segmented">
        {options.map(option => {
          const on = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={option.hint}
              onClick={() => onChange(option.value)}
              className={`inventory-view-seg ${on ? 'is-on' : ''}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Option<string>[]
  onChange: (v: string) => void
}) {
  return (
    <label className="inventory-view-group">
      <span className="inventory-view-label">{label}</span>
      <select
        className="dt-toolbar-select inventory-view-select"
        value={value}
        onChange={e => onChange(e.target.value)}
        title={options.find(o => o.value === value)?.hint}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

/**
 * One row of display controls shared by Catalog, Product Master and Warehouse.
 * Each tab passes only the controls it supports.
 */
export default function InventoryViewBar({ show, condition, sort, layout, onReset, isCustomised }: InventoryViewBarProps) {
  return (
    <div className="inventory-view-bar" role="group" aria-label="Display options">
      {show && <SelectField label="Show" value={show.value} options={show.options} onChange={show.onChange} />}
      {condition && (
        <Segmented
          label="Condition"
          value={condition.value}
          options={CONDITION_OPTIONS}
          onChange={condition.onChange}
        />
      )}
      {sort && <SelectField label="Sort" value={sort.value} options={sort.options} onChange={sort.onChange} />}
      {layout && (
        <div className="inventory-view-group" role="group" aria-label="Layout">
          <span className="inventory-view-label">Layout</span>
          <div className="inventory-view-segmented">
            {layout.presets.map(preset => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={layout.value === preset.id}
                title={preset.hint}
                onClick={() => layout.onChange(preset)}
                className={`inventory-view-seg ${layout.value === preset.id ? 'is-on' : ''}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {isCustomised && onReset && (
        <button type="button" className="inventory-view-reset" onClick={onReset}>
          Reset view
        </button>
      )}
    </div>
  )
}
