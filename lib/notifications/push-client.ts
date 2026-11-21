'use client'

/**
 * Turning on push for this device, shared by the account settings toggle and
 * the "Turn on alerts" card in the installed app.
 *
 * iPhone: push (and the number on the home-screen icon) works only in the app
 * added to the Home Screen, and the permission request must come straight from
 * a tap. So permission is asked first, before any loading.
 */

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Opened from the home-screen icon, not a browser tab. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function pushSupportedHere(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

/** Ask, subscribe and register this device. Throws a message fit for a toast. */
export async function subscribeDeviceToPush(): Promise<void> {
  if (!pushSupportedHere()) {
    throw new Error(isIosDevice() && !isInstalledApp()
      ? 'On iPhone, add Deed ERP to your Home Screen (Share → Add to Home Screen) and open it from the icon first'
      : 'This browser cannot receive push alerts')
  }
  // First, while the tap still counts (iPhone refuses a late request).
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(isIosDevice()
      ? 'Notifications are off for Deed ERP. Turn them on in iPhone Settings → Notifications → Deed ERP'
      : 'Allow notifications in the browser to turn on alerts')
  }
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  const configRes = await fetch('/api/notifications/endpoints', { cache: 'no-store' })
  const config = await configRes.json().catch(() => ({}))
  if (!configRes.ok || !config.vapidPublicKey) throw new Error('Push alerts are not configured on the server yet')
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) })
  const subJson = subscription.toJSON()
  const saveRes = await fetch('/api/notifications/endpoints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: subJson.keys,
      deviceLabel: isInstalledApp() ? (isIosDevice() ? 'iPhone app' : 'Installed app') : navigator.userAgent.includes('Mobile') ? 'Mobile browser' : 'Desktop browser',
    }),
  })
  if (!saveRes.ok) throw new Error('Could not register this device for alerts')
  // Alerts for this person go out by push from now on.
  void fetch('/api/notifications/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType: '*', pushEnabled: true }),
  }).catch(() => {})
}
