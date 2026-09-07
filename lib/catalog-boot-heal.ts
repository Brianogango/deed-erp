'use client'

const HEAL_FLAG_LS = 'deed_catalog_healed_v1'

/** One-shot catalog heals — never block first paint or the products boot GET. */
export function scheduleCatalogHealOnce(): void {
  if (typeof window === 'undefined') return
  try {
    if (window.sessionStorage.getItem(HEAL_FLAG_LS) || window.localStorage.getItem(HEAL_FLAG_LS)) return
  } catch {
    return
  }

  const run = () => {
    void (async () => {
      try {
        await fetch('/api/products/normalize-serial-tracking', { method: 'POST' })
        await fetch('/api/products/normalize-device-config', { method: 'POST' })
      } catch {
        // best-effort; flag anyway so a 403/network blip does not retry every navigation
      }
      try {
        window.sessionStorage.setItem(HEAL_FLAG_LS, '1')
        window.localStorage.setItem(HEAL_FLAG_LS, new Date().toISOString())
      } catch { /* ignore */ }
    })()
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 20_000 })
  } else {
    window.setTimeout(run, 8_000)
  }
}
