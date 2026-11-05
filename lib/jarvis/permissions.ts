import 'server-only'

import type { PublicUser, UserRole } from '@/lib/auth/types'
import { hasModuleAccess } from '@/lib/auth/access'
import { hasPermission } from '@/lib/auth/authorization'
import type { ToolDefinition } from './types'

// Per-role tool allow-list. A tool that exists in the registry but is not
// listed here for a role simply cannot be called by that role — adding a
// new tool later requires an explicit decision per role, not a default-on.
//
// This is layered ON TOP OF (not instead of) each tool's own
// requiredModule / requiredPermission check below — both must pass.
const ROLE_TOOL_ALLOWLIST: Record<UserRole, string[]> = {
  director: [
    'search_customers', 'search_vendors', 'check_inventory', 'explain_invoice', 'track_repair',
    'check_warranty', 'summarize_sales', 'summarize_repairs', 'overdue_payments', 'procurement_summary',
    'draft_quotation', 'create_quotation', 'create_invoice', 'draft_message', 'search_documents',
    'summarize_sales_leads', 'import_sales_inbox_leads',
    'create_contact', 'create_product', 'create_purchase_order', 'run_report',
  ],
  admin_officer: [
    'search_customers', 'search_vendors', 'check_inventory', 'explain_invoice', 'track_repair',
    'check_warranty', 'summarize_repairs', 'overdue_payments', 'draft_message', 'search_documents',
    'summarize_sales_leads', 'import_sales_inbox_leads',
    'create_quotation', 'create_invoice',
    'create_contact', 'create_purchase_order', 'run_report',
  ],
  finance_officer: [
    'search_customers', 'search_vendors', 'check_inventory', 'explain_invoice',
    'summarize_sales', 'overdue_payments', 'procurement_summary',
    'draft_message', 'search_documents',
    'create_invoice',
    'create_contact', 'create_purchase_order', 'run_report',
  ],
  // Inventory staff are the only ones (besides the Director) who add products.
  inventory_officer: [
    'check_inventory', 'search_vendors', 'procurement_summary', 'search_documents',
    'create_product', 'create_purchase_order', 'run_report',
  ],
  kilimall_officer: [
    'check_inventory', 'search_documents', 'run_report',
  ],
  sales_rep: [
    'search_customers', 'check_inventory', 'explain_invoice',
    'summarize_sales', 'draft_quotation', 'create_quotation', 'draft_message', 'search_documents',
    'summarize_sales_leads', 'import_sales_inbox_leads',
    'create_contact', 'run_report',
  ],
  technical_lead: [
    'check_inventory', 'search_vendors', 'track_repair', 'check_warranty', 'summarize_repairs', 'search_documents',
    'create_purchase_order', 'run_report',
  ],
  technician: [
    'track_repair', 'check_warranty', 'summarize_repairs', 'search_documents',
  ],
}

export function isToolAllowedForRole(toolName: string, role: UserRole): boolean {
  return ROLE_TOOL_ALLOWLIST[role]?.includes(toolName) ?? false
}

export function allowedToolNamesForRole(role: UserRole): string[] {
  return ROLE_TOOL_ALLOWLIST[role] ?? []
}

interface PermissionCheckResult {
  allowed: boolean
  reason?: string
}

export function checkToolPermission(
  user: PublicUser,
  tool: ToolDefinition,
): PermissionCheckResult {
  if (!isToolAllowedForRole(tool.name, user.role)) {
    return { allowed: false, reason: `Role '${user.role}' is not permitted to use tool '${tool.name}'` }
  }
  if (tool.requiredModule && !hasModuleAccess(user, tool.requiredModule)) {
    return { allowed: false, reason: `User lacks access to module '${tool.requiredModule}'` }
  }
  if (tool.requiredPermission && !hasPermission(user, tool.requiredPermission)) {
    return { allowed: false, reason: `User lacks permission '${tool.requiredPermission}'` }
  }
  return { allowed: true }
}
