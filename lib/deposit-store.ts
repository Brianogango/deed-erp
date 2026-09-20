import 'server-only'
import { loadAppState, saveStoreKeys } from './server-store'

export const DEPOSIT_STORE_KEY = 'deed_deposits'
export const LEGACY_DEPOSIT_STORE_KEY = 'deed_deposits_v1'

export type DepositStatus = 'active' | 'partially_paid' | 'fully_paid' | 'completed' | 'cancelled'

export interface DepositItem {
  productId: string
  productName: string
  sku: string
  qty: number
  unitPrice: number
  total: number
}

export interface DepositPayment {
  id: string
  date: string
  amount: number
  method: 'cash' | 'mpesa' | 'bank_transfer' | 'card'
  ref?: string
  recordedBy: string
}

export interface Deposit {
  id: string
  ref: string
  customerId: string
  customerName: string
  customerPhone: string
  items: DepositItem[]
  totalValue: number
  totalPaid: number
  balance: number
  status: DepositStatus
  payments: DepositPayment[]
  notes?: string
  createdAt: string
  createdBy: string
  dueDate?: string
  completedAt?: string
  cancelledAt?: string
  cancelReason?: string
}

function asDeposits(value: unknown): Deposit[] {
  return Array.isArray(value) ? (value as Deposit[]) : []
}

export async function readDeposits(): Promise<Deposit[]> {
  const state = await loadAppState([DEPOSIT_STORE_KEY, LEGACY_DEPOSIT_STORE_KEY])
  const primary = asDeposits(state[DEPOSIT_STORE_KEY])
  if (primary.length > 0 || Object.prototype.hasOwnProperty.call(state, DEPOSIT_STORE_KEY)) return primary
  return asDeposits(state[LEGACY_DEPOSIT_STORE_KEY])
}

export async function writeDeposits(deposits: Deposit[]): Promise<void> {
  const serialized = JSON.stringify(deposits)
  await saveStoreKeys({
    [DEPOSIT_STORE_KEY]: serialized,
    // Keep the old key mirrored while deployed clients/tests migrate.
    [LEGACY_DEPOSIT_STORE_KEY]: serialized,
  })
}
