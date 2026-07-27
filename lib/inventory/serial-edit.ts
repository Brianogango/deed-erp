export type EditableSerialFields = {
  serial: string
  barcode?: string
  notes?: string
  /** Condition / free-text issues — mapped to accessoryNotes in store */
  conditionNotes?: string
  specs?: string
}

export type SerialEditContext = {
  id: string
  serial: string
  barcode?: string
  status: string
  saleOrderId?: string
  soldDate?: string
}

export function validateSerialEdit(args: {
  current: SerialEditContext
  next: EditableSerialFields
  existing: Array<{ id: string; serial: string; barcode?: string }>
  reason?: string
  allowSoldEdit?: boolean
}): { ok: true; patch: EditableSerialFields } | { ok: false; error: string } {
  const serial = String(args.next.serial ?? '').trim()
  if (!serial) return { ok: false, error: 'Serial number is required' }

  const duplicate = args.existing.find(
    item => item.id !== args.current.id && item.serial.trim().toLowerCase() === serial.toLowerCase(),
  )
  if (duplicate) return { ok: false, error: `Serial "${serial}" already exists` }

  const barcode = String(args.next.barcode ?? '').trim()
  if (barcode) {
    const barcodeDup = args.existing.find(
      item => item.id !== args.current.id && String(item.barcode ?? '').trim().toLowerCase() === barcode.toLowerCase(),
    )
    if (barcodeDup) return { ok: false, error: `Inventory barcode "${barcode}" already exists` }
  }

  const locked = Boolean(args.current.saleOrderId || args.current.soldDate || args.current.status === 'sold')
  if (locked && !args.allowSoldEdit) {
    const serialChanged = serial.toLowerCase() !== args.current.serial.trim().toLowerCase()
    if (serialChanged) {
      return { ok: false, error: 'Sold or delivered serials cannot have their serial number changed' }
    }
  }

  if (serial.toLowerCase() !== args.current.serial.trim().toLowerCase() && !String(args.reason ?? '').trim()) {
    return { ok: false, error: 'A reason is required when correcting a serial number' }
  }

  return {
    ok: true,
    patch: {
      serial,
      barcode: barcode || serial,
      notes: args.next.notes,
      conditionNotes: args.next.conditionNotes,
      specs: args.next.specs,
    },
  }
}
