import 'server-only'

import { requireRole } from '@/lib/auth/api'
import type { Actor } from './credit-facility.server'

/** Credit applications hold a customer's financial records: sales, finance, admin and directors only. */
export const CREDIT_ROLES = ['director', 'finance_officer', 'sales_rep', 'admin_officer']

export async function requireCreditUser(): Promise<Actor> {
  const user = await requireRole(CREDIT_ROLES)
  return { id: user.id, name: user.name, role: user.role }
}
