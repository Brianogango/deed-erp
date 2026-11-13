'use client'

import { useState, type ReactNode } from 'react'
import { SearchPicker } from '@/components/ui'
import ProductFormModal from '@/components/inventory/ProductFormModal'
import { useApp, type Product } from '@/lib/store'
import { canCreateProductFromSales } from '@/lib/sales/similar-products'
import type { TrackingMethod } from '@/lib/inventory-identifiers'

/**
 * Find a product for refurbishment work — and, when it is not in the
 * catalog, create it with the Inventory product form, as on sales and
 * purchase lines. The new product is picked straight away.
 *
 * `kind`: the form starts a machine serial-tracked and a part counted.
 * A machine must stay serial-tracked (it is filed by its serial). A part may
 * be either, unless `countedOnly` (harvested parts go in as counted stock).
 */
export function RefurbProductPicker({
  label, placeholder, items, selected, onPick, onQueryChange, kind, countedOnly, emptyText, labelClassName,
}: {
  label: string
  placeholder: string
  /** The products this field offers (already filtered for the use). */
  items: Product[]
  selected?: { name: string }
  onPick: (product: Product) => void
  onQueryChange?: (query: string) => void
  kind: 'machine' | 'part'
  countedOnly?: boolean
  emptyText?: string
  labelClassName?: string
}) {
  const { users, currentUserId, showToast } = useApp()
  const role = users.find(u => u.id === currentUserId)?.role
  const canCreate = canCreateProductFromSales(role)
  const [creating, setCreating] = useState<string | null>(null)
  const tracking: TrackingMethod = kind === 'machine' ? 'SERIAL' : 'QUANTITY'
  const serial = (p: Product) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')
  const fits = (p: Product) => (kind === 'machine' ? serial(p) : !countedOnly || !serial(p))

  const row = (p: Product): ReactNode => (
    <div className="flex items-center justify-between gap-2 w-full">
      <span className="text-xs text-t1 truncate">{p.name}{p.sku ? <span className="text-t3"> · {p.sku}</span> : null}</span>
      <span className="text-[10px] text-t3 whitespace-nowrap">{p.stockQty} in stock</span>
    </div>
  )

  return (
    <>
      <SearchPicker
        label={label}
        labelClassName={labelClassName}
        placeholder={placeholder}
        items={items}
        selectedLabel={selected?.name}
        formatSelected={p => p.name}
        onSelect={onPick}
        renderItem={row}
        onQueryChange={onQueryChange}
        onCreateNew={canCreate ? q => setCreating(q.trim()) : undefined}
        createNewLabels={{
          title: kind === 'machine' ? 'Create this model' : 'Create this part',
          subtitle: 'Not in inventory? Add it with the product form',
        }}
        emptyText={emptyText ?? (canCreate ? 'No match — create it below' : 'No match — ask Inventory or your lead to add it')}
      />
      {creating !== null && (
        <ProductFormModal
          start={{ mode: 'new', name: creating, tracking }}
          onClose={() => setCreating(null)}
          onSaved={p => {
            setCreating(null)
            if (!fits(p)) {
              showToast(kind === 'machine'
                ? `${p.name} was created without serial tracking, so a machine cannot be filed under it. Set it to serial tracking in Inventory.`
                : `${p.name} was created serial-tracked; harvested parts go in as counted stock. Change its tracking in Inventory, or add it from Inventory.`, 'error')
              return
            }
            onPick(p)
          }}
        />
      )}
    </>
  )
}
