export type RepairModuleView = 'list' | 'intake' | 'detail'

/**
 * List vs job card vs intake. The open record id (URL) is the only source
 * of truth for detail — a second local `view` state used to snap back to
 * list when `?id=` had not committed yet.
 */
export function repairModuleView(isIntake: boolean, activeId: string | null | undefined): RepairModuleView {
  if (isIntake) return 'intake'
  return activeId ? 'detail' : 'list'
}
