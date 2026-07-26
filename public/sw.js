// Deed ERP Service Worker — PWA + Offline POS
//
// v4: bump runtime cache so clients drop stale fingerprinted CSS/JS after
// toolbar layout deploys. Page HTML remains network-only while online.
// v3: page HTML is never pre-cached or served from cache while online.
// v2 pre-cached '/' and '/login' at install time; after a deploy those stale
// snapshots referenced fingerprinted CSS/JS chunks that no longer existed,
// so users saw a completely unstyled login page until they cleared site data.
const CACHE = 'deed-erp-v4'
const RUNTIME_CACHE = 'deed-erp-runtime-v4'
const OFFLINE_URL = '/offline.html'

// Next.js static assets are fingerprinted — cache them aggressively
const STATIC_PATTERNS = [/_next\/static\//, /\.(png|jpg|svg|ico|woff2)$/]

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([
        OFFLINE_URL,
        '/manifest.json',
      ]).catch(() => {})  // ignore missing offline.html during dev
    )
  )
  self.skipWaiting()
})

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET, cross-origin, and API requests (always network for API)
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Next.js static assets — cache first (immutable, content-hashed names)
  if (STATIC_PATTERNS.some(p => p.test(url.pathname))) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(RUNTIME_CACHE).then(c => c.put(request, clone))
        }
        return res
      }))
    )
    return
  }

  // Pages — network only while online; the offline fallback page is the ONLY
  // cached HTML we ever serve, so a deploy can never strand a stale page
  // whose fingerprinted assets are gone.
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then(cached => cached || Response.error())
    )
  )
})

// ── Background sync (offline POS sales) ──────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pos-sales') {
    event.waitUntil(syncOfflineSales())
  }
})

async function syncOfflineSales() {
  const db = await openIDB()
  const sales = await getAllFromStore(db, 'offline_pos_sales')
  if (!sales.length) return

  for (const sale of sales) {
    try {
      const res = await fetch('/api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'deed_posOrders_sync', data: sale }),
      })
      if (res.ok) await deleteFromStore(db, 'offline_pos_sales', sale.id)
    } catch {
      // Will retry on next sync event
    }
  }
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('deed-erp-offline', 1)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('offline_pos_sales')) {
        db.createObjectStore('offline_pos_sales', { keyPath: 'id' })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

function deleteFromStore(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = e => reject(e.target.error)
  })
}
