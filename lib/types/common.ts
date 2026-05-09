/**
 * Common types used across the Deed ERP application
 */

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data: T
  status: number
  message: string
  timestamp: string
}

/**
 * Standard error response
 */
export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
  timestamp: string
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

/**
 * Result type for operations that can succeed or fail
 */
export type Result<T, E = ApiError> =
  | { success: true; data: T }
  | { success: false; error: E }

/**
 * Async result type
 */
export type AsyncResult<T, E = ApiError> = Promise<Result<T, E>>

/**
 * Status types
 */
export type Status = 'pending' | 'success' | 'error' | 'idle'

/**
 * Async state
 */
export interface AsyncState<T, E = ApiError> {
  status: Status
  data: T | null
  error: E | null
  isLoading: boolean
}

/**
 * Nullable type helper
 */
export type Nullable<T> = T | null

/**
 * Optional type helper
 */
export type Optional<T> = T | undefined

/**
 * Record with string keys
 */
export type StringRecord<T> = Record<string, T>

/**
 * Async function type
 */
export type AsyncFunction<T, R> = (arg: T) => Promise<R>

/**
 * Callback function type
 */
export type Callback<T> = (arg: T) => void

/**
 * Predicate function type
 */
export type Predicate<T> = (arg: T) => boolean

/**
 * Mapper function type
 */
export type Mapper<T, R> = (arg: T) => R

/**
 * Reducer function type
 */
export type Reducer<T, A> = (state: T, action: A) => T

/**
 * Timestamp in ISO format
 */
export type ISODateTime = string & { readonly __brand: 'ISODateTime' }

/**
 * Date in YYYY-MM-DD format
 */
export type DateString = string & { readonly __brand: 'DateString' }

/**
 * Currency amount
 */
export type Currency = number & { readonly __brand: 'Currency' }

/**
 * Percentage (0-100)
 */
export type Percentage = number & { readonly __brand: 'Percentage' }

/**
 * Helper to create branded types
 */
export const brand = <T, B extends string>(value: T): T & { readonly __brand: B } => {
  return value as T & { readonly __brand: B }
}

/**
 * Create ISO DateTime
 */
export function createISODateTime(date: Date = new Date()): ISODateTime {
  return brand<string, 'ISODateTime'>(date.toISOString())
}

/**
 * Create DateString
 */
export function createDateString(date: Date = new Date()): DateString {
  return brand<string, 'DateString'>(date.toISOString().split('T')[0])
}
