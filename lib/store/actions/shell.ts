// @ts-nocheck -- moved unchanged from the provider, which is not type-checked yet
import { markNotificationReadInList, markAllNotificationsReadForUser, clearReadNotificationsForUser } from '@/lib/in-app-notifications'
import { compressProfileImage } from '../sync'
import { normalizePricingMarginPolicy } from '@/lib/pricing/margin-policy'
import { hasModuleAccess as userHasModuleAccess } from '@/lib/auth/access'
import { requestCreateUser, requestUpdateUser, requestDeleteUser, requestDeactivateUser, requestReactivateUser } from '@/lib/auth/client-users'
import type { User } from '../core'
import { isDirector } from '@/lib/auth/roles'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** shell actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createShellActions(store: StoreDeps): Pick<AppState, 'markNotificationRead' | 'markAllNotificationsRead' | 'clearReadNotifications' | 'setProfileImage' | 'updateCompanySettings' | 'updateSystemSettings' | 'setModule' | 'toggleSidebar' | 'login' | 'logout' | 'createUser' | 'updateUser' | 'unlockUser' | 'deleteUser' | 'deactivateUser' | 'reactivateUser' | 'resendCredentials' | 'hasModuleAccess' | 'isSuperAdmin'> {
  return {
    markNotificationRead: (id) => {
        store.setNotifications(prev => markNotificationReadInList(prev, id))
      },

    markAllNotificationsRead: () => {
        const uid = store.currentUserId
        if (!uid) return
        store.setNotifications(prev => markAllNotificationsReadForUser(prev, uid))
      },

    clearReadNotifications: () => {
        const uid = store.currentUserId
        if (!uid) return
        store.setNotifications(prev => clearReadNotificationsForUser(prev, uid))
      },

    setProfileImage: (userId, dataUrl) => {
        compressProfileImage(dataUrl).then(compressed => {
          store.setProfileImages(prev => ({ ...prev, [userId]: compressed }))
        })
      },

    updateCompanySettings: (p) => store.setCompanySettings(prev => ({ ...prev, ...p })),

    updateSystemSettings: (p) => store.setSystemSettings(prev => {
        const next = { ...prev, ...p }
        if (p.pricingMarginPolicy) {
          next.pricingMarginPolicy = normalizePricingMarginPolicy(p.pricingMarginPolicy)
        }
        return next
      }),

    // ────────────────────────────────────────────────────────────────────────

    setModule: (m) => {
        const user = store.currentUser()
        if (!userHasModuleAccess(user, m)) {
          store.showToast('Access denied', 'error')
          store.addAuditLog('access_denied', m, `Denied access to ${m}`)
          return
        }
        store.setActiveModule(m)
        if (typeof window !== 'undefined') window.localStorage.setItem('activeModule', m)
        // Page views stay in this session's activity list. Sent to the server
        // they cost a full audit-log rewrite per click and, with the log capped
        // at 5,000 entries, pushed real commercial records out within days.
        store.addAuditLog('navigate', m, `Navigated to ${m}`, { sessionOnly: true })
      },

    toggleSidebar: () => store.setSidebarOpen(v => !v),

    login: async (username, password) => {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          })
  
          if (!res.ok) {
            store.showToast('Invalid username or password', 'error')
            store.addAuditLog('login_failed', username, 'Failed login attempt')
            return false
          }
  
          window.location.href = '/'
          return true
        } catch {
          store.showToast('Unable to reach the authentication service', 'error')
          return false
        }
      },

    logout: async () => {
        const user = store.currentUser()
        if (user) store.addAuditLog('logout', user.username, 'User logged out')
        await fetch('/api/auth/logout', { method: 'POST' })
        store.setCurrentUserId(null)
        store.setActiveModule('dashboard')
        // P0-DEED-001 / SEC-004: purge business + draft keys on explicit logout
        try {
          const { purgeClientBusinessStorage } = await import('@/hooks/useFormDraft')
          purgeClientBusinessStorage()
          const { clearCollectionCache } = await import('@/lib/browser-collection-cache')
          await clearCollectionCache()
        } catch {
          // ignore — still complete logout
        }
        store.showToast('Logged out')
        window.location.href = '/login'
      },

    createUser: async (u) => {
        const { ok, payload } = await requestCreateUser(u)
  
        if (!ok || !payload || !('user' in payload) || !payload.user) {
          const message = payload?.message ?? 'Unable to create user'
          store.showToast(message, 'error')
          throw new Error(message)
        }
  
        const user = payload.user as User
        store.setUsers(prev => [user, ...prev.filter(item => item.id !== user.id)])
        store.addAuditLog('create_user', user.username, `Created user ${user.name}`)
  
        const temporaryPassword = (payload as any).temporaryPassword as string | undefined
        const credentialDelivery = (payload as any).credentialDelivery
        if (temporaryPassword) {
          window.alert(`User created for ${user.name}.\n\nEmail delivery failed or no email address is available.\n\nTemporary password (share securely):\n\n${temporaryPassword}`)
        } else if (credentialDelivery?.success) {
          store.showToast(`User created and credentials emailed to ${user.email || user.name}`)
        } else {
          store.showToast(`User created for ${user.name}`)
        }
        return user
      },

    updateUser: async (id, p) => {
        const { ok, payload } = await requestUpdateUser(id, p)
  
        if (!ok || !payload || !('user' in payload) || !payload.user) {
          const message = payload?.message ?? 'Unable to update user'
          store.showToast(message, 'error')
          throw new Error(message)
        }
  
        const user = payload.user as User
        store.setUsers(prev => prev.map(item => item.id === id ? user : item))
        store.addAuditLog('update_user', id, `Updated user ${user.name}`)
        store.showToast('User profile updated')
      },

    unlockUser: async (id) => {
        const { ok, payload } = await requestUpdateUser(id, { unlock: true })
  
        if (!ok || !payload || !('user' in payload) || !payload.user) {
          const message = payload?.message ?? 'Unable to unlock user'
          store.showToast(message, 'error')
          throw new Error(message)
        }
  
        const user = payload.user as User
        store.setUsers(prev => prev.map(item => item.id === id ? user : item))
        store.addAuditLog('unlock_user', id, `Unlocked user ${user.username}`)
        store.showToast('User unlocked successfully')
      },

    deleteUser: async (id) => {
        const { ok, payload } = await requestDeleteUser(id)
        if (!ok) {
          const message = payload?.message ?? 'Unable to delete user'
          store.showToast(message, 'error')
          throw new Error(message)
        }
        store.setUsers(prev => prev.filter(u => u.id !== id))
        store.addAuditLog('delete_user', id, `Deleted user ${id}`)
        store.showToast('User deleted')
      },

    deactivateUser: async (id) => {
        const { ok, payload } = await requestDeactivateUser(id)
        if (!ok) {
          const message = payload?.message ?? 'Unable to deactivate user'
          store.showToast(message, 'error')
          throw new Error(message)
        }
        store.setUsers(prev => prev.map(u => u.id === id ? { ...u, active: false } : u))
        store.addAuditLog('deactivate_user', id, `Deactivated user ${id}`)
        store.showToast('User deactivated')
      },

    reactivateUser: async (id) => {
        const { ok, payload } = await requestReactivateUser(id)
        if (!ok) {
          const message = payload?.message ?? 'Unable to reactivate user'
          store.showToast(message, 'error')
          throw new Error(message)
        }
        store.setUsers(prev => prev.map(u => u.id === id ? { ...u, active: true } : u))
        store.addAuditLog('reactivate_user', id, `Reactivated user ${id}`)
        store.showToast('User reactivated')
      },

    resendCredentials: async (id) => {
        try {
          const res = await fetch(`/api/users/${id}/resend-credentials`, { method: 'POST' })
          const data = await res.json().catch(() => ({})) as any
          if (!res.ok) {
            store.showToast(data?.message || 'Failed to resend credentials', 'error')
            throw new Error(data?.message || 'resend failed')
          }
          const temporaryPassword = data.temporaryPassword as string | undefined
          if (temporaryPassword) {
            window.alert(`Credentials reset for ${data.user?.name || 'the user'}.\n\nEmail delivery failed or no email address is available.\n\nNew temporary password (share securely):\n\n${temporaryPassword}`)
          } else if (data.credentialDelivery?.success) {
            store.showToast(`Credentials reset and emailed to ${data.user?.email || data.user?.name || 'the user'}`)
          } else {
            store.showToast(`Credentials reset for ${data.user?.name || 'the user'}`)
          }
          store.addAuditLog('resend_credentials', id, `Resent credentials for user ${id}`)
          if (data.user) store.setUsers(prev => prev.map(u => u.id === id ? data.user as User : u))
        } catch (e) {
          // already toasted
          throw e
        }
      },

    hasModuleAccess: (module) => userHasModuleAccess(store.currentUser(), module),

    isSuperAdmin: () => isDirector(store.currentUser()?.role),
  }
}
