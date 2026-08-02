import { useEffect, useRef, useState } from 'react'
import { parseStoredState } from '@/lib/safe-local-state'

export function useLS<T>(key: string, seed: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  // Always start with seed to match server render — avoids hydration mismatch
  const [state, setState] = useState<T>(seed)
  const hydrated = useRef(false)

  // Read from localStorage only after mount (client-only)
  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    try {
      const stored = window.localStorage.getItem(key)
      const { value, corrupted } = parseStoredState(stored, seed)
      if (corrupted) {
        try { window.localStorage.removeItem(key) } catch { /* ignore */ }
      } else if (stored !== null) {
        setState(value)
      }
    } catch { /* corrupted — keep seed */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Persist on state change after hydration — debounced to avoid blocking the main thread
  useEffect(() => {
    if (!hydrated.current) return
    const timer = setTimeout(() => {
      try { window.localStorage.setItem(key, JSON.stringify(state)) } catch { /* quota exceeded */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [state, key])

  return [state, setState]
}

