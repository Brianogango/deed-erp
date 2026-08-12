/**
 * One-shot client recovery for blank / "Something went wrong" states after
 * deploys or corrupted localStorage. Clears ERP cache keys + SW runtime
 * caches, then reloads. Guarded by sessionStorage so it cannot loop.
 */

export const CLIENT_RECOVERY_FLAG = 'deed_client_recovered'

/** Stale-deploy / corrupt-cache signatures that should auto Repair & reload. */
export const STALE_BUILD_PATTERNS: RegExp[] = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /clientModules/,
  /Unexpected token '<'/,
  /\.filter is not a function/i,
  /\.map is not a function/i,
  /Cannot read propert(y|ies) of (undefined|null)/i,
  /Failed to find Server Action/i,
  /older or newer deployment/i,
]

export function isRecoverableClientError(error: Error | { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const text = `${error.name || ''}: ${error.message || ''}`
  return STALE_BUILD_PATTERNS.some(re => re.test(text))
}

export function clearDeedClientCaches(): { clearedKeys: number } {
  let clearedKeys = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key) continue
      if (
        key.startsWith('deed_') ||
        key.startsWith('deed-') ||
        key === 'deed_dirty_keys' ||
        key === 'deed_last_synced_at' ||
        key === 'deed_data_version'
      ) {
        keys.push(key)
      }
    }
    keys.forEach(key => {
      try {
        window.localStorage.removeItem(key)
        clearedKeys += 1
      } catch { /* ignore */ }
    })
  } catch { /* storage blocked */ }

  try {
    window.sessionStorage.removeItem('deed_stale_build_reloaded')
  } catch { /* ignore */ }

  return { clearedKeys }
}

export async function clearServiceWorkerCaches(): Promise<void> {
  try {
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(name => name.startsWith('deed-erp'))
          .map(name => caches.delete(name)),
      )
    }
  } catch { /* ignore */ }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(reg => reg.update().catch(() => {})))
    }
  } catch { /* ignore */ }
}

/** Returns true if a recovery reload was triggered. */
export async function recoverClientOnce(reason: string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(CLIENT_RECOVERY_FLAG) === '1') return false
    sessionStorage.setItem(CLIENT_RECOVERY_FLAG, '1')
  } catch {
    // If sessionStorage is unavailable, still attempt a single recovery.
  }

  try {
    console.warn('[deed-client-recovery]', reason)
  } catch { /* ignore */ }

  clearDeedClientCaches()
  await clearServiceWorkerCaches()
  window.location.reload()
  return true
}

export function resetClientRecoveryFlag() {
  try {
    sessionStorage.removeItem(CLIENT_RECOVERY_FLAG)
    sessionStorage.removeItem('deed_stale_build_reloaded')
  } catch { /* ignore */ }
}
