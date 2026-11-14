// @ts-nocheck -- moved unchanged from the provider, which is not type-checked yet
import type { SOP, SOPActual } from '../sop'
import { uid, now } from '../ids'
import type { RefSOP } from '../hr'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** sop actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createSopActions(store: StoreDeps): Pick<AppState, 'createSOP' | 'updateSOP' | 'deleteSOP' | 'setSopActual' | 'addRefSop' | 'updateRefSop' | 'deleteRefSop'> {
  return {
    createSOP: (s) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return null }
        const sop: SOP = { ...s, id: uid(), createdByUserId: user.id, createdByName: user.name, createdAt: now() }
        store.setSops(prev => [...prev, sop])
        store.showToast('SOP created', 'success')
        return sop
      },

    updateSOP: (id, p) => {
        store.setSops(prev => prev.map(s => s.id === id ? { ...s, ...p } : s))
        store.showToast('SOP updated', 'success')
      },

    deleteSOP: (id) => {
        store.setSops(prev => prev.filter(s => s.id !== id))
        store.showToast('SOP deleted', 'info')
      },

    setSopActual: (sopId, metricId, periodKey, actual, notes) => {
        const user = store.currentUser()
        if (!user) return
        store.setSopActuals(prev => {
          const existing = prev.findIndex(a => a.sopId === sopId && a.metricId === metricId && a.periodKey === periodKey)
          const entry: SOPActual = { id: uid(), sopId, metricId, periodKey, actual, notes, updatedByUserId: user.id, updatedByName: user.name, updatedDate: now() }
          if (existing >= 0) return prev.map((a, i) => i === existing ? entry : a)
          return [...prev, entry]
        })
      },

    addRefSop: (s) => {
        const user = store.currentUser()
        const doc: RefSOP = { ...s, id: uid(), updatedAt: now(), createdByName: user?.name ?? 'Admin' }
        store.setRefSops(p => [doc, ...p])
        store.showToast('Document added to Reference Library')
      },

    updateRefSop: (id, p) => {
        store.setRefSops(prev => prev.map(s => s.id === id ? { ...s, ...p, updatedAt: now() } : s))
        store.showToast('Document updated')
      },

    deleteRefSop: (id) => {
        store.setRefSops(p => p.filter(s => s.id !== id))
        store.showToast('Document deleted')
      },
  }
}
