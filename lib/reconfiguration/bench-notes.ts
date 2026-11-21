/**
 * What a bench job keeps in its notes: the request, the before/after
 * configuration and price it was asked for, and why it stopped if it did.
 * Shared by the server (to resume a job) and the screen (to offer Finish,
 * Undo or Reverse).
 */
import type { DeviceConfigFields } from './types'

export type BenchNotes = {
  version: number
  ram: unknown
  storage: unknown
  nameBefore?: string
  nameAfter?: string
  finalSellingPrice?: number | null
  before?: DeviceConfigFields
  proposed?: DeviceConfigFields
  /** Why the job stopped half-way, for the screen. */
  stuck?: { message: string; at: string }
  reversed?: { reason: string; at: string; byUserId?: string | null }
}


export function readBenchNotes(notes: string | null | undefined): BenchNotes | null {
  try {
    const parsed = JSON.parse(String(notes ?? '').split('\n')[0] || '{}')
    return parsed && typeof parsed === 'object' && parsed.bench ? parsed.bench as BenchNotes : null
  } catch {
    return null
  }
}


/** A job written with its full plan up front (version 2) can be finished; older ones only undone. */
export function canFinishStuckBenchJob(notes: string | null | undefined): boolean {
  return (readBenchNotes(notes)?.version ?? 1) >= 2
}
