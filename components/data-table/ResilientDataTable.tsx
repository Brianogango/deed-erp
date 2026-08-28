'use client'

import { useMemo, useState } from 'react'
import BaseDataTable, { type DataTableProps } from './DataTable'
import { getColumnValue } from '@/lib/data-table/types'
import { matchesSearch } from '@/lib/search-utils'

/**
 * Cross-ERP DataTable facade.
 *
 * The legacy DataTable searched only breakpoint-eligible columns. That meant a
 * record could be searchable on desktop but disappear from the same search on
 * mobile because secondary columns were hidden. This facade owns default
 * client search and evaluates every declared searchable column consistently.
 *
 * Callers that deliberately set clientSearch={false} keep full ownership of
 * their bespoke/server-side search behavior.
 */
export default function ResilientDataTable<T>(props: DataTableProps<T>) {
  const {
    rows,
    columns,
    clientSearch = true,
    searchValue,
    onSearchChange,
    ...rest
  } = props

  const [internalSearch, setInternalSearch] = useState('')
  const effectiveSearch = searchValue !== undefined ? searchValue : internalSearch

  // Hooks stay unconditional even for bespoke/server-side search callers.
  // In that mode the memo simply hands rows through untouched.
  const filteredRows = useMemo(() => {
    if (!clientSearch || !effectiveSearch.trim()) return rows
    return rows.filter(row => {
      const values = columns.map(column => getColumnValue(column, row, 'search'))
      return matchesSearch(effectiveSearch, ...values)
    })
  }, [rows, columns, effectiveSearch, clientSearch])

  const handleSearchChange = (value: string) => {
    if (searchValue === undefined) setInternalSearch(value)
    onSearchChange?.(value)
  }

  if (!clientSearch) {
    return (
      <BaseDataTable
        {...props}
        clientSearch={false}
      />
    )
  }

  return (
    <BaseDataTable
      {...rest}
      columns={columns}
      rows={filteredRows}
      clientSearch={false}
      searchValue={effectiveSearch}
      onSearchChange={handleSearchChange}
    />
  )
}

export type { DataTableProps }
