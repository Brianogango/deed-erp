// Pure, testable helpers behind the centralized dashboard and module landing
// behaviour. The dashboard renders in strict priority order (P1 alerts →
// P2 workload → P3 analytics → P4 shortcuts), and every section is gated by
// the matrix below. Data-level security is enforced server-side by the
// role/module/content-filtered store APIs (lib/auth/authorization.ts); these
// helpers independently keep dashboard rendering aligned with that policy.

import { canApproveLeaveRole } from '@/lib/auth/access'
import type { ModuleId, PublicUser, UserRole } from '@/lib/auth/types'

export interface DashboardSections {
  /** Revenue / receivables / payables KPIs and money-denominated analytics. */
  finance: boolean
  /** Sales KPIs and pipeline content. */
  sales: boolean
  /** Full sales analytics (charts) in the P3 disclosure section. */
  salesAnalytics: boolean
  /** Stock health card + inventory KPIs. */
  inventory: boolean
  /** Inventory category overview (P3). Officers live in the module instead. */
  inventoryOverview: boolean
  /** Workshop / repair queue card. */
  workshop: boolean
  /** Purchasing follow-up KPIs. */
  purchasing: boolean
  /** Kilimall marketplace KPIs. */
  kilimall: boolean
  /** Organisation-wide HR/approvals oversight. */
  hrAdmin: boolean
  /** Leave decision queue, aligned with the dedicated server API roles. */
  leaveApprovals: boolean
  /** Monthly repair revenue trend (P3). */
  repairRevenue: boolean
}

export function dashboardSectionsForRole(role: UserRole | string | null | undefined): DashboardSections {
  const r = String(role ?? '')
  const isDirector = r === 'director'
  const isAdmin = r === 'admin_officer'
  const isFinance = r === 'finance_officer'
  const isInventory = r === 'inventory_officer'
  const isKilimall = r === 'kilimall_officer'
  const isSalesRep = r === 'sales_rep'
  const isLead = r === 'technical_lead'
  const isTech = r === 'technician'

  const inventory = isDirector || isAdmin || isFinance || isInventory || isKilimall || isLead
  return {
    finance: isDirector || isFinance,
    sales: isDirector || isAdmin || isFinance || isSalesRep,
    salesAnalytics: isDirector || isAdmin || isFinance || isSalesRep,
    inventory,
    inventoryOverview: inventory && !isInventory && !isKilimall,
    workshop: isDirector || isLead || isTech,
    purchasing: isDirector || isAdmin || isFinance || isInventory,
    kilimall: isDirector || isFinance || isKilimall,
    hrAdmin: isDirector,
    leaveApprovals: canApproveLeaveRole(r),
    repairRevenue: isLead,
  }
}

type DashboardUser = Pick<PublicUser, 'id' | 'role' | 'modules'>

const DASHBOARD_SECTION_MODULES: Record<keyof DashboardSections, ModuleId> = {
  finance: 'accounting',
  sales: 'sales',
  salesAnalytics: 'sales',
  inventory: 'inventory',
  inventoryOverview: 'inventory',
  workshop: 'repair',
  purchasing: 'purchase',
  kilimall: 'kilimall',
  hrAdmin: 'hr',
  leaveApprovals: 'hr',
  repairRevenue: 'repair',
}

export function hasExplicitModuleGrant(
  user: Pick<PublicUser, 'modules'> | null | undefined,
  module: ModuleId,
): boolean {
  return !!user?.modules?.includes(module)
}

export const DASHBOARD_KPI_MODULES: Readonly<Record<string, ModuleId>> = {
  'active-users': 'dashboard',
  revenue: 'accounting',
  outstanding: 'accounting',
  payables: 'accounting',
  'cash-bank': 'accounting',
  'cash-hand': 'accounting',
  payroll: 'hr',
  approvals: 'hr',
  leave: 'hr',
  expenses: 'expenses',
  'my-expenses': 'expenses',
  settlements: 'kilimall',
  pending: 'kilimall',
  dispatched: 'kilimall',
  returns: 'kilimall',
  sales: 'sales',
  'open-orders': 'sales',
  quotes: 'sales',
  orders: 'sales',
  'my-quotes': 'sales',
  'my-orders': 'sales',
  'my-pipeline': 'sales',
  'my-invoiced': 'sales',
  customers: 'contacts',
  'my-customers': 'contacts',
  purchase: 'purchase',
  receipts: 'purchase',
  stock: 'inventory',
  'low-stock': 'inventory',
  skus: 'inventory',
  units: 'inventory',
  transfers: 'inventory',
  repairs: 'repair',
  'repair-revenue': 'repair',
  active: 'repair',
  unassigned: 'repair',
  parts: 'repair',
  qc: 'repair',
  'my-active': 'repair',
  'my-parts': 'repair',
  'my-qc': 'repair',
  'my-ready': 'repair',
  refurb: 'refurbishment',
  outsource: 'outsource',
}

export function canShowDashboardKpi(
  user: Pick<PublicUser, 'modules'> | null | undefined,
  key: string,
): boolean {
  const module = DASHBOARD_KPI_MODULES[key]
  return !module || hasExplicitModuleGrant(user, module)
}

/**
 * Dashboard visibility is the intersection of role authority and the user's
 * explicit module grants. This is intentionally stricter than navigation's
 * director shortcut: dashboard cards can summarize sensitive records.
 */
export function dashboardSectionsForUser(
  user: DashboardUser | null | undefined,
): DashboardSections {
  const roleSections = dashboardSectionsForRole(user?.role)
  return Object.fromEntries(
    (Object.keys(roleSections) as (keyof DashboardSections)[]).map(section => [
      section,
      roleSections[section] && hasExplicitModuleGrant(user, DASHBOARD_SECTION_MODULES[section]),
    ]),
  ) as unknown as DashboardSections
}

export function canShowDashboardLeaveApprovals(
  user: DashboardUser | null | undefined,
): boolean {
  return dashboardSectionsForUser(user).leaveApprovals
}

export function visibleDashboardSalesOrders<T extends { createdByUserId?: string }>(
  user: DashboardUser | null | undefined,
  orders: readonly T[],
): T[] {
  if (!dashboardSectionsForUser(user).sales) return []
  if (user?.role === 'sales_rep') return orders.filter(order => order.createdByUserId === user.id)
  return [...orders]
}

export function visibleDashboardRepUsers<T extends { id: string }>(
  user: DashboardUser | null | undefined,
  reps: readonly T[],
): T[] {
  if (!dashboardSectionsForUser(user).salesAnalytics) return []
  if (user?.role === 'sales_rep') return reps.filter(rep => rep.id === user.id)
  return [...reps]
}

export function visibleDashboardRepairs<T extends { assignedTechnicianId?: string }>(
  user: DashboardUser | null | undefined,
  repairs: readonly T[],
): T[] {
  if (!dashboardSectionsForUser(user).workshop) return []
  if (user?.role === 'technician') return repairs.filter(repair => repair.assignedTechnicianId === user.id)
  return [...repairs]
}

// ── Sales module landing ─────────────────────────────────────────────────────
// The module-level dashboard and Rep Performance moved to the central
// dashboard, and After Sales lives in its own module (/aftersales — the Sales
// component redirects that legacy deep link itself). Anything unknown or
// legacy ('dashboard', 'reps', …) resolves to the operational order list.
export type SalesTab = 'list' | 'crm'
const SALES_TABS: SalesTab[] = ['list', 'crm']

export function resolveSalesTab(param: string | null | undefined): SalesTab {
  if (param && (SALES_TABS as string[]).includes(param)) return param as SalesTab
  return 'list'
}

// ── Settings deep links ──────────────────────────────────────────────────────
// Settings selects sections with local state; these aliases let ?tab= deep
// links (e.g. the dashboard's Active Users card) land on the right section.
export const SETTINGS_SECTIONS = [
  'general', 'banks', 'access', 'crm', 'sales', 'inventory', 'purchase',
  'repair', 'accounting', 'hr_config', 'pos', 'security', 'partner_api',
] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]

const SETTINGS_ALIASES: Record<string, SettingsSection> = {
  users: 'access',
  account: 'general',
  company: 'general',
  hr: 'hr_config',
}

export function resolveSettingsSection(param: string | null | undefined): SettingsSection {
  if (!param) return 'general'
  if ((SETTINGS_SECTIONS as readonly string[]).includes(param)) return param as SettingsSection
  return SETTINGS_ALIASES[param] ?? 'general'
}
