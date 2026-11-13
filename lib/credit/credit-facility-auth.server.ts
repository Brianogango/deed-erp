import 'server-only'

import { requirePermission } from '@/lib/auth/api'
import type { Actor } from './credit-facility.server'

/** Credit applications hold a customer's financial records (sales.credit_applications). */

export async function requireCreditUser(): Promise<Actor> {
  const user = await requirePermission('sales.credit_applications')
  return { id: user.id, name: user.name, role: user.role }
}
