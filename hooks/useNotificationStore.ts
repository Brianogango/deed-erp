import { create } from 'zustand'

/**
 * Toast-only UI state.
 *
 * Durable business notifications are owned by the relational notification
 * subsystem and /api/notifications. Do not add client-generated notification
 * rows here; browser state is not an authoritative event source.
 *
 * AppShell still renders toast from StoreProvider. This slice is a fan-out so
 * domain hooks can call showToast without mounting a second Toast UI.
 */
interface NotificationUiState {
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}

export const useNotificationStore = create<NotificationUiState>((set) => ({
  toast: null,
  showToast: (msg, type = 'success') => {
    set({ toast: { msg, type } })
    setTimeout(() => set({ toast: null }), 3500)
  },
}))
