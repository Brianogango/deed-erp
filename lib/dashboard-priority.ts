// Pure, testable helpers behind the centralized dashboard and module landing
// behaviour. The dashboard renders in strict priority order (P1 alerts →
// P2 workload → P3 analytics → P4 shortcuts), and every section is gated by
// the matrix below. Data-level security is enforced server-side by the
// role-filtered store APIs (lib/auth/authorization.ts) — this matrix only
// decides which sections are worth rendering for a role.

import type { UserRole } from '@/lib/auth/types'

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
    repairRevenue: isLead,
  }
}

// ── Sales module landing ─────────────────────────────────────────────────────
// The module-level sales dashboard was consolidated into the central dashboard;
// the module now always lands on the operational order list. Legacy
// `?tab=dashboard` deep links (bookmarks, notifications) resolve to the list.
export type SalesTab = 'list' | 'crm' | 'reps' | 'after_sales'
const SALES_TABS: SalesTab[] = ['list', 'crm', 'reps', 'after_sales']

export function resolveSalesTab(param: string | null | undefined): SalesTab {
  if (param && (SALES_TABS as string[]).includes(param)) return param as SalesTab
  return 'list' // covers null, legacy 'dashboard', and unknown values
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
