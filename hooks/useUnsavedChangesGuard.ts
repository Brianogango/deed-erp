'use client'

import { useCallback, useEffect } from 'react'

/**
 * Adds a browser-level guard for dirty forms and exposes a guarded navigation helper.
 * Use guardedNavigate instead of directly closing a dirty modal or leaving a record.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  message = 'You have unsaved changes. Leave without saving?'
) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const confirmDiscard = useCallback(() => !dirty || window.confirm(message), [dirty, message])

  const guardedNavigate = useCallback((navigate: () => void) => {
    if (confirmDiscard()) navigate()
  }, [confirmDiscard])

  return { confirmDiscard, guardedNavigate }
}
