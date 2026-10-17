import 'server-only'
import type { Cheque } from '@prisma/client'
import { CHEQUE_STATUSES, chequeAlert, type ChequeAlert, type ChequeDirection, type ChequeStatus } from './cheque-rules'

export const CHEQUE_IMAGE_BUCKET = 'uploads'
export const CHEQUE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const CHEQUE_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export type ChequeHistoryEntry = { at: string; by: string; status: ChequeStatus; note?: string }

export interface ChequeDto {
  id: string
  direction: ChequeDirection
  chequeNumber: string
  bankName: string
  partyName: string
  amount: number
  currency: string
  chequeDate: string
  receivedDate: string | null
  status: ChequeStatus
  linkedType: string | null
  linkedRef: string | null
  notes: string | null
  hasImage: boolean
  history: ChequeHistoryEntry[]
  alert: ChequeAlert
  createdAt: string
  updatedAt: string
}

/** Today in Nairobi as YYYY-MM-DD — the date cheques are judged against. */
export function nairobiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null)

export function toChequeDto(row: Cheque, today = nairobiToday()): ChequeDto {
  const status = (CHEQUE_STATUSES as string[]).includes(row.status) ? (row.status as ChequeStatus) : 'pending'
  const chequeDate = day(row.chequeDate) as string
  return {
    id: row.id,
    direction: row.direction === 'given' ? 'given' : 'received',
    chequeNumber: row.chequeNumber,
    bankName: row.bankName,
    partyName: row.partyName,
    amount: Number(row.amount),
    currency: row.currency,
    chequeDate,
    receivedDate: day(row.receivedDate),
    status,
    linkedType: row.linkedType,
    linkedRef: row.linkedRef,
    notes: row.notes,
    hasImage: Boolean(row.imageKey),
    history: Array.isArray(row.history) ? (row.history as ChequeHistoryEntry[]) : [],
    alert: chequeAlert({ status, chequeDate }, today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function chequeImageKey(id: string, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  return `cheques/${id}.${ext}`
}
