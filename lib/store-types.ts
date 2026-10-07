/**
 * store-types.ts
 * Canonical re-export of all domain types from the store.
 *
 * Components that only need TYPE information (not store functions) should
 * import from here instead of '@/lib/store'. This decouples type-only
 * consumers from the full provider bundle and makes future type migrations
 * (e.g. moving definitions here) a one-line change per type.
 *
 * Usage:
 *   import type { Company, Employee, LeaveRequest } from '@/lib/store-types'
 */

export type {
  CategoryId
} from '@/lib/store'
