export type OpeningStockValidationLine = {
  productId: string
  productName?: string
  qty: number
  requiresSerial: boolean
  serials?: string[]
  serialSkus?: string[]
}

export type ReceiptValidationLine = {
  productId: string
  productName?: string
  qtyReceived: number
  requiresSerial: boolean
  serials?: string[]
}

const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase()

type ExistingSerial = { serial?: string | null; barcode?: string | null }

function buildExistingSerialSet(existingSerials: ExistingSerial[]) {
  return new Set(existingSerials.map(item => normalize(item.serial)).filter(Boolean))
}

function buildDuplicateIndexes(values: string[]) {
  const index = new Map<string, number[]>()
  values.forEach((value, idx) => {
    const key = normalize(value)
    if (!key) return
    const arr = index.get(key) ?? []
    arr.push(idx)
    index.set(key, arr)
  })
  return index
}

export function validateOpeningStockInput(
  items: OpeningStockValidationLine[],
  existingSerials: ExistingSerial[],
) {
  const errors: string[] = []
  const existing = buildExistingSerialSet(existingSerials)
  const payloadSerials: string[] = []

  items.forEach((item, idx) => {
    const lineNo = idx + 1
    if (!item.productId) errors.push(`Line ${lineNo}: productId is required`)
    if (!Number.isFinite(item.qty) || item.qty <= 0) errors.push(`Line ${lineNo}: qty must be greater than zero`)
    if (!item.requiresSerial) return

    const serials = (item.serials ?? []).map(serial => String(serial).trim()).filter(Boolean)
    if (serials.length !== item.qty) {
      errors.push(`Line ${lineNo}: serialized product requires exactly ${item.qty} serial number(s), got ${serials.length}`)
      return
    }
    serials.forEach(serial => {
      payloadSerials.push(serial)
      if (existing.has(normalize(serial))) {
        errors.push(`Line ${lineNo}: serial "${serial}" already exists`)
      }
    })
  })

  const duplicates = buildDuplicateIndexes(payloadSerials)
  duplicates.forEach((positions, serial) => {
    if (positions.length > 1) errors.push(`Opening payload has duplicate serial "${serial}"`)
  })

  return { ok: errors.length === 0, errors }
}

export function validateReceiptInput(
  lines: ReceiptValidationLine[],
  existingSerials: ExistingSerial[],
) {
  const errors: string[] = []
  const existing = buildExistingSerialSet(existingSerials)
  const payloadSerials: string[] = []

  lines.forEach((line, idx) => {
    const lineNo = idx + 1
    if (!line.productId) errors.push(`Line ${lineNo}: productId is required`)
    if (!Number.isFinite(line.qtyReceived) || line.qtyReceived < 0) errors.push(`Line ${lineNo}: qtyReceived must be zero or greater`)
    if (!line.requiresSerial || line.qtyReceived === 0) return

    const serials = (line.serials ?? []).map(serial => String(serial).trim()).filter(Boolean)
    if (serials.length !== line.qtyReceived) {
      errors.push(`Line ${lineNo}: serialized receipt line requires exactly ${line.qtyReceived} serial number(s), got ${serials.length}`)
      return
    }
    serials.forEach(serial => {
      payloadSerials.push(serial)
      if (existing.has(normalize(serial))) {
        errors.push(`Line ${lineNo}: serial "${serial}" already exists`)
      }
    })
  })

  const duplicates = buildDuplicateIndexes(payloadSerials)
  duplicates.forEach((positions, serial) => {
    if (positions.length > 1) errors.push(`Receipt payload has duplicate serial "${serial}"`)
  })

  return { ok: errors.length === 0, errors }
}
