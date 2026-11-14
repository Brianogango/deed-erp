/**
 * Client-safe inventory permission helpers — thin names over the shared
 * permission check (lib/auth/can.ts), so the screens ask exactly what the
 * server asks.
 */
import { userCan } from '@/lib/auth/can'

type Role = string | null | undefined

export const canValidatePurchaseReceipt = (role: Role) => userCan({ role }, 'validatePurchaseReceipt')

export const canEditSerialNumber = (role: Role) => userCan({ role }, 'editSerialNumber')

/** Add available on-hand serials from the product Serials drawer. */
export const canIntakeOnHandSerials = (role: Role) => userCan({ role }, 'inventory.serials.intake')

/** Release held (assigned) serials back to available on-hand stock. */
export const canReleaseHeldSerial = (role: Role) => userCan({ role }, 'inventory.serials.release')

export const canPrintInventoryLabels = (role: Role) => userCan({ role }, 'printInventoryLabels')

export const canViewPurchaseCost = (role: Role) => userCan({ role }, 'viewPurchaseCost')

/** Archiving a product is an inventory approval (as deleting one is). */
export const canArchiveProduct = (role: Role) => userCan({ role }, 'manageInventoryApprovals')
