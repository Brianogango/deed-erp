/**
 * Pure business-logic functions extracted from lib/store.tsx so they can be
 * unit-tested without importing React or the full client-side store.
 *
 * Rules: no side effects, no React imports, no server-only imports.
 * Every function here must be a pure transform: input → output.
 */

import type { LocationId } from './store'

// ── Minimal types (mirrors store types without the full import chain) ──────────

export interface StockProduct {
  requiresSerial: boolean
}

export interface SerialNumber {
  productId: string
  location: LocationId
  status: string
}

export interface BulkStockLevel {
  productId: string
  location: LocationId
  qty: number
}

export interface PayrollEmployee {
  id: string
  fullName: string
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
}

export interface PayrollLine {
  employeeId: string
  employeeName: string
  basicSalary: number
  allowances: number
  deductions: number
  netPay: number
}

// ── Stock calculations ─────────────────────────────────────────────────────────

/**
 * Returns the quantity of a product at each stock location.
 * Serial products are counted by active serial records.
 * Bulk products are read directly from BulkStockLevel entries.
 */
export function calcStockByLocation(
  product: StockProduct | undefined,
  serials: SerialNumber[],
  bulkStock: BulkStockLevel[],
  productId: string,
): Record<LocationId, number> {
  const locs: Record<LocationId, number> = {
    warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0,
  }
  if (!product) return locs

  if (product.requiresSerial) {
    serials
      .filter(s => s.productId === productId && ['available', 'assigned', 'under_repair', 'refurbishment', 'in_stock'].includes(s.status))
      .forEach(s => { locs[s.location] = (locs[s.location] || 0) + 1 })
  } else {
    bulkStock
      .filter(level => level.productId === productId)
      .forEach(level => { locs[level.location] = level.qty })
  }
  return locs
}

/**
 * Adds `delta` units to a product at a location in a bulk-stock level list.
 * Result quantity is floored at 0 (never goes negative).
 * Returns a new array — does not mutate the input.
 */
export function upsertBulkStock(
  levels: BulkStockLevel[],
  productId: string,
  location: LocationId,
  delta: number,
): BulkStockLevel[] {
  const current = levels.find(l => l.productId === productId && l.location === location)?.qty ?? 0
  const nextQty = Math.max(0, current + delta)
  const remaining = levels.filter(l => !(l.productId === productId && l.location === location))
  return nextQty > 0 ? [...remaining, { productId, location, qty: nextQty }] : remaining
}

// ── Payroll calculations ───────────────────────────────────────────────────────

/**
 * Computes a single payroll line for an employee.
 * Formula (mirrors store.tsx createPayrollRun):
 *   allowances  = housingAllowance + transportAllowance
 *   deductions  = round(basicSalary × 0.18)
 *   netPay      = basicSalary + allowances − deductions
 */
export function computePayrollLine(emp: PayrollEmployee): PayrollLine {
  const allowances = emp.housingAllowance + emp.transportAllowance
  const deductions = Math.round(emp.basicSalary * 0.18)
  const netPay = emp.basicSalary + allowances - deductions
  return {
    employeeId: emp.id,
    employeeName: emp.fullName,
    basicSalary: emp.basicSalary,
    allowances,
    deductions,
    netPay,
  }
}

/**
 * Aggregates totals across all payroll lines.
 */
export function aggregatePayroll(lines: PayrollLine[]) {
  return {
    totalGross: lines.reduce((s, l) => s + l.basicSalary + l.allowances, 0),
    totalDeductions: lines.reduce((s, l) => s + l.deductions, 0),
    totalNet: lines.reduce((s, l) => s + l.netPay, 0),
  }
}

// ── Deposit payment helpers ───────────────────────────────────────────────────

export type DepositStatus = 'active' | 'partially_paid' | 'fully_paid' | 'completed' | 'cancelled'

/**
 * Determines the new deposit status after a payment.
 * Returns 'fully_paid' when balance reaches or goes below 0.
 */
export function resolveDepositStatus(newBalance: number): DepositStatus {
  return newBalance <= 0 ? 'fully_paid' : 'partially_paid'
}

/**
 * Caps payment at remaining balance so totalPaid never exceeds totalValue.
 */
export function capPayment(requestedAmount: number, remainingBalance: number): number {
  return Math.min(requestedAmount, remainingBalance)
}
