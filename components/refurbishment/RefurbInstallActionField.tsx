'use client'

import { Field } from '@/components/ui'
import {
  defaultRefurbInstallAction,
  refurbPartCapacitySlot,
  type RefurbCapacitySlot,
  type RefurbInstallAction,
  type RefurbNameProduct,
} from '@/lib/refurbishment/apply-upgrade-specs'

export function refurbFitSlotForForm(opts: {
  partName: string
  productId?: string
  products: RefurbNameProduct[]
}): RefurbCapacitySlot | null {
  return refurbPartCapacitySlot(
    { partName: opts.partName, productId: opts.productId },
    opts.products,
  )
}

export function RefurbInstallActionField({
  slot,
  value,
  onChange,
  afterName,
}: {
  slot: RefurbCapacitySlot
  value?: RefurbInstallAction
  onChange: (action: RefurbInstallAction) => void
  afterName?: string | null
}) {
  const selected = value || defaultRefurbInstallAction(slot)
  const noun = slot === 'ram' ? 'RAM' : 'SSD'
  const hint = selected === 'add'
    ? `Leaves what is already in. ${noun} totals go up.`
    : `Pulls the old ${noun === 'RAM' ? 'stick' : 'drive'}. Capacity becomes this part.`

  return (
    <Field
      label="How is it fitted?"
      hint={afterName ? `${hint} Client will see: ${afterName}` : hint}
    >
      <select
        className="form-select w-full"
        value={selected}
        onChange={e => onChange(e.target.value as RefurbInstallAction)}
      >
        <option value="add">Add next to existing</option>
        <option value="swap">Swap — take the old one out</option>
      </select>
    </Field>
  )
}
