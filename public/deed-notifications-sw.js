self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch {}
  const title = payload.title || 'Deed ERP'
  const options = {
    body: payload.body || 'You have a new notification.',
    icon: '/deed-logo.png',
    badge: '/deed-logo.png',
    data: { url: payload.url || '/' },
    tag: payload.eventType || 'deed-notification',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined
    })
  )
})
