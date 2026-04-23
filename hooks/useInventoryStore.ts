// @ts-nocheck
import { create } from 'zustand'
import { useLS } from './useLS'
import type { Product, SerialNumber, PurchaseOrder, Receipt, StockTransfer, StockMove, BulkStockLevel } from '../lib/store.types'
import { seq, now } from '../lib/data'

interface InventoryState {
  products: Product[]
  serials: SerialNumber[]
  purchaseOrders: PurchaseOrder[]
  receipts: Receipt[]
  stockTransfers: StockTransfer[]
  stockMoves: StockMove[]
  bulkStock: BulkStockLevel[]
  addProduct: (p: Omit<Product, 'id'>) => Product
  // ... other inventory actions
}

export const useInventoryStore = create<InventoryState>((set: any) => ({
  products: [],
  serials: [],
  purchaseOrders: [],
  receipts: [],
  stockTransfers: [],
  stockMoves: [],
  bulkStock: [],
  addProduct: (p) => {
    const prod = { ...p, id: crypto.randomUUID() }
    set((state) => ({ products: [...state.products, prod] }))
    return prod
  },
  // stub other actions
}))

export default useInventoryStore

