/**
 * Repair list ordering — newest intake first, with createdDate/ref as tie-breakers.
 */

import { compareSortValues } from '@/lib/data-table/sort'

export type RepairSortable = {
  ref?: string
  intakeDate?: string
  createdDate?: string
  createdAt?: string
}

function repairRecencyKey(r: RepairSortable): string {
  return String(r.intakeDate || r.createdDate || r.createdAt || '')
}

function repairTieKey(r: RepairSortable): string {
  return String(r.createdDate || r.createdAt || r.ref || '')
}

/** Newest repairs first (intake date, then created time / ref). */
export function compareRepairsNewestFirst(a: RepairSortable, b: RepairSortable): number {
  const byIntake = compareSortValues(repairRecencyKey(b), repairRecencyKey(a))
  if (byIntake !== 0) return byIntake
  const byCreated = compareSortValues(repairTieKey(b), repairTieKey(a))
  if (byCreated !== 0) return byCreated
  return String(b.ref || '').localeCompare(String(a.ref || ''), undefined, { numeric: true })
}

export function sortRepairsNewestFirst<T extends RepairSortable>(repairs: T[]): T[] {
  return [...repairs].sort(compareRepairsNewestFirst)
}
