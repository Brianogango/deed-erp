'use client'

import { useCallback } from 'react'
import { useApp } from '@/lib/store'
import { userCan } from '@/lib/auth/can'

/**
 * `const can = useCan(); can('manageInventoryApprovals')` — whether the
 * signed-in person holds a permission. The same check the server makes, so a
 * button shows exactly when the action would be accepted.
 */
export function useCan(): (permission: string) => boolean {
  const { users, currentUserId } = useApp()
  const me = users.find(u => u.id === currentUserId) ?? null
  return useCallback((permission: string) => userCan(me, permission), [me])
}
