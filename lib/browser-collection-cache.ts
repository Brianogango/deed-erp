/**
 * Collections kept in IndexedDB between visits.
 *
 * localStorage holds about 5 MB per site; the ERP's collections are larger
 * than that together, so they were evicted and re-downloaded on every
 * reload and new tab, and writing a 1 MB string to it blocks the page. Here
 * every collection is also written to IndexedDB (no practical size limit,
 * asynchronous). On load the page shows the cached copy and asks the server
 * whether it changed (ETag): unchanged collections cost a 304, not a download.
 *
 * Copies are per user and cleared on logout. A route's ETag is saved only
 * after the data it describes has been written here, so a cached copy can
 * never be older than the version the browser claims to hold.
 */

const DB_NAME = 'deed-collections'
const STORE = 'collections'
const WRITE_DELAY_MS = 1500

let cacheUser: string | null = null
let dbPromise: Promise<IDBDatabase | null> | null = null
const pending = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null

function available() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise(resolve => {
      try {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return dbPromise
}

const recordKey = (user: string, key: string) => `${user}:${key}`

/** Whose copies are read and written. Nothing is cached without a user. */
export function setCollectionCacheUser(userId: string | null | undefined) {
  if (cacheUser !== (userId || null)) {
    pending.clear()
    cacheUser = userId || null
  }
}

async function writeEntries(entries: Array<[string, string]>): Promise<boolean> {
  const user = cacheUser
  const db = await openDb()
  if (!db || !user || !entries.length) return false
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const [key, value] of entries) store.put(value, recordKey(user, key))
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

function flushSoon() {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const entries = [...pending.entries()]
    pending.clear()
    void writeEntries(entries)
  }, WRITE_DELAY_MS)
}

/** Remember a collection (debounced: many edits in a row write once). */
export function cacheCollection(key: string, serialized: string) {
  if (!cacheUser || !serialized.startsWith('[')) return
  pending.set(key, serialized)
  flushSoon()
}

/**
 * Write server copies now and resolve once they are stored — callers save
 * the ETag for this data only after this returns true.
 */
export async function cacheCollectionsNow(values: Record<string, string>): Promise<boolean> {
  const entries = Object.entries(values).filter(([, v]) => typeof v === 'string' && v.startsWith('['))
  for (const [key] of entries) pending.delete(key)
  if (!entries.length) return true
  return writeEntries(entries)
}

/** Cached copies of these keys for the current user (missing keys are absent). */
export async function readCachedCollections(keys: string[]): Promise<Record<string, string>> {
  const user = cacheUser
  const db = await openDb()
  if (!db || !user || !keys.length) return {}
  return new Promise(resolve => {
    const out: Record<string, string> = {}
    try {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      for (const key of keys) {
        const req = store.get(recordKey(user, key))
        req.onsuccess = () => { if (typeof req.result === 'string') out[key] = req.result }
      }
      tx.oncomplete = () => resolve(out)
      tx.onerror = () => resolve(out)
      tx.onabort = () => resolve(out)
    } catch {
      resolve(out)
    }
  })
}

/** Logout: forget every cached collection, for every user on this browser. */
export async function clearCollectionCache(): Promise<void> {
  pending.clear()
  if (timer) { clearTimeout(timer); timer = null }
  const db = await openDb()
  if (!db) return
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
