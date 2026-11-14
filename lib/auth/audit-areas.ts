/**
 * The audit trail, by area of the business. Each saved data key belongs to
 * the area of its module (from the save rules), and a person reads the areas
 * they hold audit.view.<area> for; viewAuditLog reads everything. Pure.
 */
import { STORE_WRITE_POLICIES } from './store-write-policy'
import { userCan } from './can'

export const AUDIT_AREAS = ['users', 'inventory', 'sales', 'finance', 'hr'] as const
export type AuditArea = (typeof AUDIT_AREAS)[number]

export const AUDIT_AREA_LABELS: Record<AuditArea, string> = {
  users: 'User accounts',
  inventory: 'Inventory & purchases',
  sales: 'Sales & repairs',
  finance: 'Finance',
  hr: 'HR',
}

const MODULE_AREA: Record<string, AuditArea> = {
  accounting: 'finance', expenses: 'finance', deposits: 'finance', company_property: 'finance',
  inventory: 'inventory', purchase: 'inventory', delivery: 'inventory', refurbishment: 'inventory', reconfiguration: 'inventory',
  sales: 'sales', crm: 'sales', pos: 'sales', kilimall: 'sales', contacts: 'sales', repair: 'sales', ecommerce: 'sales',
  hr: 'hr', leave: 'hr', my_documents: 'hr',
}

/** The areas a saved key belongs to (invoices: sales and finance); none means Director only. */
export function auditAreasOfKey(key: string): AuditArea[] {
  return [...new Set((STORE_WRITE_POLICIES[key]?.modules ?? []).map(module => MODULE_AREA[module]).filter(Boolean))]
}

type Viewer = Parameters<typeof userCan>[0]

/** 'all' for the whole trail, else the areas this person may read (possibly none). */
export function auditAreasFor(viewer: Viewer): 'all' | Set<AuditArea> {
  if (userCan(viewer, 'viewAuditLog')) return 'all'
  return new Set(AUDIT_AREAS.filter(area => userCan(viewer, `audit.view.${area}`)))
}

export const canReadAuditArea = (viewer: Viewer, area: AuditArea) => {
  const areas = auditAreasFor(viewer)
  return areas === 'all' || areas.has(area)
}

/** The keys of a save this viewer may see; empty when the whole entry is outside their areas. */
export function visibleAuditKeys(keys: readonly string[] | undefined, areas: 'all' | Set<AuditArea>): string[] {
  const list = keys ?? []
  if (areas === 'all') return [...list]
  return list.filter(key => auditAreasOfKey(key).some(area => areas.has(area)))
}
