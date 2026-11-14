import { type User } from './core'
import { userCan } from '@/lib/auth/can'

/** Permission shortcuts the store and screens use. */

export const canApproveInventoryAction = (user: User | null) => userCan(user, 'manageInventoryApprovals')

/** GRN / purchase receipt validation — narrower than general inventory approvals. */
export const canValidatePurchaseReceiptAction = (user: User | null) => userCan(user, 'validatePurchaseReceipt')

export const canManageInventoryControl = (user: User | null) => userCan(user, 'inventory.stock_requests')

export const canManageHR = (user: User | null) => userCan(user, 'manageHR')

export const canApprovePayroll = (user: User | null) => userCan(user, 'approvePayroll')

export const canManageHRAssets = (user: User | null) => userCan(user, 'hr.assets.manage')

/** Broad money role (includes Admin Officer) — use with threshold helpers for post/pay. */
export const canManageFinance = (user: User | null) => userCan(user, 'postFinancial')

/** Bank recon / expense reimburse — Finance + Director only. */
export const canManageFullFinanceAction = (user: User | null) => userCan(user, 'accounting.manage')

/** Draft customer invoice from SO. */
export const canCreateCustomerInvoiceFromSOAction = (user: User | null) => userCan(user, 'createCustomerInvoiceFromSO')

export const canManageProcurement = (user: User | null) => userCan(user, 'manageProcurement')
