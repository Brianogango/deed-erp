// @ts-nocheck
'use client'

import { useSharedStore } from '../hooks/useSharedStore'
import { useSalesStore } from '../hooks/useSalesStore'
import { useRepairStore } from '../hooks/useRepairStore'
import { useInventoryStore } from '../hooks/useInventoryStore'
import { useNotificationStore } from '../hooks/useNotificationStore'
// import other stores...

interface StoreProviderProps {
  children: React.ReactNode
  initialUser?: any
  initialUsers?: any[]
  initialModule?: string
}

export function StoreProvider({ children, initialUser, initialUsers, initialModule }: StoreProviderProps) {
  // Initialize shared store with initial data
  useSharedStore.setState({ 
    users: initialUsers || [],
    currentUserId: initialUser?.id || null,
    activeModule: initialModule || 'dashboard'
  })
  
  return <>{children}</>
}

