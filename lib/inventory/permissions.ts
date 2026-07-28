/**
 * Client-safe inventory permission helpers.
 * Role lists intentionally mirror lib/auth/authorization.ts server matrix.
 */

export type InventoryRole =
  | 'director'
  | 'admin_officer'
  | 'finance_officer'
  | 'inventory_officer'
  | 'technical_lead'
  | 'kilimall_officer'
  | 'sales_rep'
  | 'technician'
  | string

const RECEIPT_VALIDATORS: InventoryRole[] = [
  'director',
  'admin_officer',
  'inventory_officer',
]

const SERIAL_EDITORS: InventoryRole[] = [
  'director',
  'admin_officer',
  'inventory_officer',
  'technical_lead',
]

const SERIAL_RELEASE_ROLES: InventoryRole[] = [
  'director',
  'admin_officer',
  'inventory_officer',
]

const LABEL_USERS: InventoryRole[] = [
  'director',
  'admin_officer',
  'inventory_officer',
  'technical_lead',
  'kilimall_officer',
  'finance_officer',
]

const COST_VIEWERS: InventoryRole[] = [
  'director',
  'admin_officer',
  'finance_officer',
  'inventory_officer',
]

export function canValidatePurchaseReceipt(role: InventoryRole | null | undefined) {
  return !!role && RECEIPT_VALIDATORS.includes(role)
}

export function canEditSerialNumber(role: InventoryRole | null | undefined) {
  return !!role && SERIAL_EDITORS.includes(role)
}

/** Release held (assigned) serials back to available on-hand stock. */
export function canReleaseHeldSerial(role: InventoryRole | null | undefined) {
  return !!role && SERIAL_RELEASE_ROLES.includes(role)
}

export function canPrintInventoryLabels(role: InventoryRole | null | undefined) {
  return !!role && LABEL_USERS.includes(role)
}

export function canViewPurchaseCost(role: InventoryRole | null | undefined) {
  return !!role && COST_VIEWERS.includes(role)
}

export function canViewVendorLedger(role: InventoryRole | null | undefined) {
  return !!role && [
    'director',
    'admin_officer',
    'finance_officer',
    'inventory_officer',
    'technical_lead',
  ].includes(role)
}
