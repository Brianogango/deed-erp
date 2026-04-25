// Essential seed data for Deed ERP - TypeScript FIXED
// Unblocks all modules. Replace localStorage demo data in store.tsx

import type {
  Product, SaleOrder, RepairOrder, PurchaseOrder, SerialNumber, Employee, Contact, Account
} from './store'
export { uid, seq, now, addDays } from './utils'
import { now } from './utils'

export const SEED_PRODUCTS: Product[] = []
export const SEED_CONTACTS: Contact[] = []
export const SEED_SERIALS: SerialNumber[] = []
export const SEED_SALE_ORDERS: SaleOrder[] = []
export const SEED_REPAIRS: RepairOrder[] = []
