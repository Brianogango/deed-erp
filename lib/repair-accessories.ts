/**
 * Shared repair accessory catalog for intake checkboxes and the A6 ticket label.
 * Label checkboxes use the short card names; intake may store aliases
 * ("Charger / Adapter", "Laptop Bag", …) — matching is case-insensitive and
 * alias-aware so checked items actually tick on the printed label.
 */

export const REPAIR_LABEL_ACCESSORIES = [
  'Bag',
  'Keyboard',
  'Hard Disk',
  'Processor',
  'Battery',
  'Adapter',
  'Memory',
  'Cover',
  'DVD Drive',
] as const

export type RepairLabelAccessory = (typeof REPAIR_LABEL_ACCESSORIES)[number]

/** Intake UI options — label items first, then common extras. */
export const REPAIR_INTAKE_ACCESSORIES = [
  'Adapter',
  'Bag',
  'Keyboard',
  'Hard Disk',
  'Battery',
  'Memory',
  'Cover',
  'DVD Drive',
  'Processor',
  'Mouse',
  'HDMI Cable',
  'Power Cable',
  'Stylus / Pen',
] as const

/** Alias tokens (lowercase) that map an intake / free-text name onto a label checkbox. */
const LABEL_ACCESSORY_ALIASES: Record<RepairLabelAccessory, readonly string[]> = {
  Bag: ['bag', 'laptop bag', 'case', 'sleeve', 'bag/case', 'bag / case'],
  Keyboard: ['keyboard'],
  'Hard Disk': ['hard disk', 'hard drive', 'hdd', 'external hdd', 'ssd', 'external ssd', 'disk'],
  Processor: ['processor', 'cpu'],
  Battery: ['battery'],
  Adapter: ['adapter', 'charger', 'charger / adapter', 'charger/adapter', 'power adapter', 'psu', 'power supply'],
  Memory: ['memory', 'ram'],
  Cover: ['cover', 'lid', 'bottom cover'],
  'DVD Drive': ['dvd', 'dvd drive', 'optical', 'optical drive', 'cd drive'],
}

export type RepairAccessoryEntry = { name: string; received?: boolean; notes?: string }

function normalizeAccessoryKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Whether a stored accessory name should tick the given label checkbox.
 * Exact match wins; otherwise alias / includes matching.
 */
export function accessoryMatchesLabelName(storedName: string, labelName: RepairLabelAccessory): boolean {
  const stored = normalizeAccessoryKey(storedName)
  const label = normalizeAccessoryKey(labelName)
  if (!stored) return false
  if (stored === label) return true

  const aliases = LABEL_ACCESSORY_ALIASES[labelName] ?? []
  if (aliases.some(a => stored === a || stored.includes(a) || a.includes(stored))) return true

  // "Charger / Adapter" ↔ Adapter, "Laptop Bag" ↔ Bag, etc.
  return stored.includes(label) || label.includes(stored)
}

/** True when the repair has a received accessory that maps to this label checkbox. */
export function isLabelAccessoryReceived(
  accessories: readonly RepairAccessoryEntry[] | null | undefined,
  labelName: RepairLabelAccessory,
): boolean {
  if (!Array.isArray(accessories) || accessories.length === 0) return false
  return accessories.some(a => {
    if (!a || a.received === false) return false
    return accessoryMatchesLabelName(String(a.name ?? ''), labelName)
  })
}

/**
 * Merge a create/POST shell into an already-enriched repair without wiping
 * intake fields (Direct Repair path, accessories, waiver) that landed via
 * a parallel store sync or updateRepair.
 */
export function mergeRepairCreatePreserveIntake<T extends Record<string, unknown>>(
  existing: T,
  incoming: T,
): T {
  const existingAccessories = Array.isArray(existing.accessories) ? existing.accessories : []
  const incomingAccessories = Array.isArray(incoming.accessories) ? incoming.accessories : []
  const existingPath = existing.repairPath === 'direct_repair' ? 'direct_repair' : existing.repairPath
  const incomingPath = incoming.repairPath === 'direct_repair' ? 'direct_repair' : incoming.repairPath

  const merged: T = {
    ...existing,
    ...incoming,
  }

  // Never let a bare create shell downgrade Direct Repair back to diagnosis-first.
  if (existingPath === 'direct_repair' && incomingPath !== 'direct_repair') {
    ;(merged as Record<string, unknown>).repairPath = 'direct_repair'
    if (incoming.liabilityWaiverAccepted == null && existing.liabilityWaiverAccepted != null) {
      ;(merged as Record<string, unknown>).liabilityWaiverAccepted = existing.liabilityWaiverAccepted
      ;(merged as Record<string, unknown>).liabilityWaiverText = existing.liabilityWaiverText
      ;(merged as Record<string, unknown>).liabilityWaiverAcceptedAt = existing.liabilityWaiverAcceptedAt
      ;(merged as Record<string, unknown>).liabilityWaiverSignature = existing.liabilityWaiverSignature
    }
  } else if (incomingPath === 'direct_repair') {
    ;(merged as Record<string, unknown>).repairPath = 'direct_repair'
  }

  if (incomingAccessories.length === 0 && existingAccessories.length > 0) {
    ;(merged as Record<string, unknown>).accessories = existingAccessories
  }

  const existingNotes = String(existing.notes ?? '')
  const incomingNotes = String(incoming.notes ?? '')
  if ((!incomingNotes || incomingNotes.length < existingNotes.length) && existingNotes) {
    ;(merged as Record<string, unknown>).notes = existingNotes
  }

  return merged
}
