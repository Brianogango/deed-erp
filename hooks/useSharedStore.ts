// @ts-nocheck
/**
 * NOT the ERP source of truth for auth or module routing.
 * StoreProvider in lib/store.tsx owns currentUser, login, and activeModule.
 * Do not mount this store in the app shell — a second SoT would fork login state.
 */
import { create } from 'zustand'
import { useLS } from './useLS'
import type { ModuleId, UserRole, User } from '../lib/store'
import { getFirstAllowedModule, hasModuleAccess as userHasModuleAccess } from '../lib/auth/access'
import { requestLogin, requestLogout } from '../lib/auth/client'
import { requestCreateUser, requestDeleteUser, requestUpdateUser } from '../lib/auth/client-users'
import type { CreateUserInput, UpdateUserInput } from '../lib/auth/types'
import { uid, now } from '../lib/data'

interface SharedState {
  activeModule: ModuleId
  sidebarOpen: boolean
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null
  users: User[]
  currentUserId: string | null
  setModule: (m: ModuleId) => void
  toggleSidebar: () => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  createUser: (u: CreateUserInput) => Promise<User>
  updateUser: (id: string, p: UpdateUserInput) => Promise<void>
  deleteUser: (id: string) => Promise<void>
  hasModuleAccess: (module: ModuleId) => boolean
  isSuperAdmin: () => boolean
}

export const useSharedStore = create<SharedState>((set: any, get: any) => ({
  activeModule: 'dashboard' as ModuleId,
  sidebarOpen: true,
  toast: null,
  users: [],
  currentUserId: null,
  setModule: (m) => {
    const user = get().currentUserId ? get().users.find(u => u.id === get().currentUserId) ?? null : null
    if (!userHasModuleAccess(user, m)) return
    set({ activeModule: m })
    if (typeof window !== 'undefined') localStorage.setItem('activeModule', m)
  },
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  showToast: (msg, type = 'success') => {
    set({ toast: { msg, type } })
    setTimeout(() => set({ toast: null }), 3500)
  },
  async login(username, password) {
    try {
      const { ok, payload } = await requestLogin(username, password)
      if (!ok || !payload?.user) {
        get().showToast(payload?.message ?? 'Invalid credentials', 'error')
        return false
      }
      const user = payload.user as User
      set((state) => ({
        users: state.users.some(u => u.id === user.id) 
          ? state.users.map(u => u.id === user.id ? user : u)
          : [user, ...state.users],
        currentUserId: user.id,
        activeModule: payload.defaultModule ?? getFirstAllowedModule(user)
      }))
      get().showToast(`Welcome ${user.name}`)
      return true
    } catch {
      get().showToast('Authentication error', 'error')
      return false
    }
  },
  async logout() {
    try { await requestLogout() } catch {}
    set({ currentUserId: null, activeModule: 'dashboard' })
    get().showToast('Logged out')
  },
  async createUser(u) {
    const { ok, payload } = await requestCreateUser(u)
    if (!ok || !payload?.user) throw new Error(payload?.message ?? 'Create failed')
    const user = payload.user as User
    set((state) => ({
      users: [user, ...state.users.filter(item => item.id !== user.id)]
    }))
    get().showToast('User created')
    return user
  },
  async updateUser(id, p) {
    const { ok, payload } = await requestUpdateUser(id, p)
    if (!ok || !payload?.user) throw new Error(payload?.message ?? 'Update failed')
    const user = payload.user as User
    set((state) => ({
      users: state.users.map(item => item.id === id ? user : item)
    }))
    get().showToast('User updated')
  },
  async deleteUser(id) {
    const { ok, payload } = await requestDeleteUser(id)
    if (!ok) throw new Error(payload?.message ?? 'Delete failed')
    set((state) => ({
      users: state.users.filter(u => u.id !== id)
    }))
    get().showToast('User deleted')
  },
  hasModuleAccess: (module) => {
    const user = get().currentUserId ? get().users.find(u => u.id === get().currentUserId) ?? null : null
    return userHasModuleAccess(user, module)
  },
  isSuperAdmin: () => {
    const user = get().currentUserId ? get().users.find(u => u.id === get().currentUserId) ?? null : null
    return user?.role === 'director'
  }
}))

export const useAuthStore = () => useSharedStore((state) => ({
  users: state.users,
  currentUserId: state.currentUserId,
  login: state.login,
  logout: state.logout,
  createUser: state.createUser,
  updateUser: state.updateUser,
  deleteUser: state.deleteUser,
  hasModuleAccess: state.hasModuleAccess,
  isSuperAdmin: state.isSuperAdmin,
}))

