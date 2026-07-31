import type { RepairQAItem } from '@/lib/repair-types'

export const DEFAULT_REPAIR_QC_DESCRIPTIONS = [
  'Device powers on successfully',
  'Reported issue(s) fully resolved',
  'No new issues introduced during repair',
  'All accessories present and returned',
  'Device cleaned and presentable',
] as const

export function buildDefaultRepairQcItems(uid: () => string): RepairQAItem[] {
  return DEFAULT_REPAIR_QC_DESCRIPTIONS.map(description => ({
    id: uid(),
    description,
    passed: false,
  }))
}

/** Ensure a non-empty checklist; clear prior pass ticks for a fresh QC round. */
export function prepareRepairQcItemsForRound(
  existing: RepairQAItem[] | null | undefined,
  uid: () => string,
): RepairQAItem[] {
  const list = Array.isArray(existing) ? existing : []
  if (list.length === 0) return buildDefaultRepairQcItems(uid)
  return list.map(item => ({
    ...item,
    passed: false,
    testedBy: undefined,
    testedDate: undefined,
    notes: undefined,
  }))
}

export function summarizeFailedQcItems(items: RepairQAItem[]): string {
  return items
    .filter(item => !item.passed)
    .map(item => item.notes?.trim() ? `${item.description} (${item.notes.trim()})` : item.description)
    .join('; ')
}
