// @ts-nocheck
import { create } from 'zustand'
import type { AppNotification, NotifType, ModuleId } from '../lib/store.types'
import { uid, now } from '../lib/data'

interface NotificationState {
  notifications: AppNotification[]
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  pushNotif: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => void
}

export const useNotificationStore = create<NotificationState>((set: any, get: any) => ({
  notifications: [],
  toast: null,
  markNotificationRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map(n => n.id === id ? { ...n, read: true } : n)
    }))
  },
  markAllNotificationsRead: () => {
    set((state) => ({
      notifications: state.notifications.map(n => ({ ...n, read: true }))
    }))
  },
  showToast: (msg, type = 'success') => {
    set({ toast: { msg, type } })
    setTimeout(() => set({ toast: null }), 3500)
  },
  pushNotif: (n) => {
    const notif: AppNotification = { ...n, id: uid(), createdAt: now(), read: false }
    set((state) => ({ notifications: [notif, ...state.notifications] }))
  }
}))

