// Deed ERP Service Worker — PWA + Offline POS
const CACHE = 'deed-erp-v3'
const OFFLINE_URL = '/offline.html'

// Next.js static assets are fingerprinted — cache them aggressively
const STATIC_PATTERNS = [/_next\/static\//, /\.(png|jpg|svg|ico|woff2)$/]
const RUNTIME_CACHE   = 'deed-erp-runtime-v3'

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([
        '/',
        '/login',
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
    ).then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(client => client.navigate(client.url)))
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

  // Next.js static assets — cache first
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

  // Pages — network first, fall back to cache, then offline page
  event.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(RUNTIME_CACHE).then(c => c.put(request, clone))
        }
        return res
      })
      .catch(() =>
        caches.match(request).then(cached => cached || caches.match(OFFLINE_URL))
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
