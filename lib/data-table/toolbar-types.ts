import type { ReactNode } from 'react'

export interface ToolbarFilterOption {
  value: string
  label: string
}

/** A frequently used filter shown directly in the toolbar (desktop/tablet). */
export interface PrimaryFilterConfig {
  key: string
  label: string
  /** Placeholder / empty option label inside the select. */
  placeholder?: string
  value: string
  options: ToolbarFilterOption[]
  onChange: (value: string) => void
  /** Value treated as “no filter” for chips / counts. Defaults to `"all"`. */
  allValue?: string
}

export interface ActiveFilterChip {
  key: string
  label: string
  valueLabel: string
  onRemove: () => void
}

export type ExportFormatId = 'pdf' | 'excel' | 'csv' | 'print' | string

export interface ExportMenuOption {
  id: ExportFormatId
  label: string
  onSelect: () => void | Promise<void>
  disabled?: boolean
}

export interface OverflowAction {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

export interface LayoutViewOption {
  id: string
  label: string
  icon?: ReactNode
}

export interface LayoutViewsConfig {
  value: string
  options: LayoutViewOption[]
  onChange: (id: string) => void
}
