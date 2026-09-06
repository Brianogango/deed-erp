/**
 * Repair workspace `?id=` can be a repair order, a refurbishment job, or
 * neither. The Refurbishment board used to feed job ids into Repair detail,
 * which hid the list and rendered nothing.
 */

export type RepairWorkspaceIdKind = 'none' | 'repair' | 'refurb' | 'unknown'

export function resolveRepairWorkspaceId(
  activeId: string | null | undefined,
  repairIds: Iterable<string>,
  refurbIds: Iterable<string>,
): RepairWorkspaceIdKind {
  if (!activeId) return 'none'
  for (const id of repairIds) {
    if (id === activeId) return 'repair'
  }
  for (const id of refurbIds) {
    if (id === activeId) return 'refurb'
  }
  return 'unknown'
}

export function refurbishmentJobHref(id: string): string {
  return `/refurbishment?id=${encodeURIComponent(id)}`
}

export function isDeedRepairsBlobDirty(rawDirtyKeys: string | null | undefined): boolean {
  if (!rawDirtyKeys) return false
  try {
    const keys = JSON.parse(rawDirtyKeys) as unknown
    return Array.isArray(keys) && keys.includes('deed_repairs_v2')
  } catch {
    return false
  }
}

/**
 * A polled GET /api/repairs/:id must not overlay a local write that has not
 * synced. In-flight responses from before the last local mutation are also
 * dropped so a late 200 cannot snap the job card backwards.
 */
export function canApplyPolledRepair(opts: {
  repairsBlobDirty: boolean
  localGeneration: number
  fetchGeneration: number
}): boolean {
  if (opts.repairsBlobDirty) return false
  return opts.fetchGeneration === opts.localGeneration
}

export type RepairDetailPanel = 'hidden' | 'detail' | 'loading' | 'missing'

export function repairDetailPanel(opts: {
  view: 'list' | 'intake' | 'detail'
  hasActiveRepair: boolean
  lookup: 'idle' | 'loading' | 'missing'
}): RepairDetailPanel {
  if (opts.view !== 'detail') return 'hidden'
  if (opts.hasActiveRepair) return 'detail'
  return opts.lookup === 'loading' ? 'loading' : 'missing'
}
