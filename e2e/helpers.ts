import { expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test'
import { E2E_USER, E2E_USERS } from './global-setup'

/** Unique suffix so parallel CI re-runs do not collide on names/phones. */
export function e2eTag(label = 'wf') {
  return `e2e-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

type E2EIdentity = (typeof E2E_USERS)[keyof typeof E2E_USERS]

export async function loginAs(browser: Browser, identity: E2EIdentity): Promise<BrowserContext> {
  const context = await browser.newContext()
  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await context.request.post('/api/auth/login', {
      data: { username: identity.username, password: identity.password },
    })
    lastStatus = res.status()
    if (lastStatus === 200) return context
    if (lastStatus === 429 && attempt < 3) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    break
  }
  expect(lastStatus, `login should succeed for ${identity.role}`).toBe(200)
  return context
}

/** Log in as the seeded director and return an authenticated browser context. */
export async function loginViaApi(browser: Browser): Promise<BrowserContext> {
  return loginAs(browser, E2E_USER)
}

export async function jsonOrThrow(res: Awaited<ReturnType<APIRequestContext['post']>>, label: string) {
  const status = res.status()
  const body = await res.json().catch(() => ({}))
  if (status >= 400) {
    throw new Error(`${label} failed (${status}): ${JSON.stringify(body)}`)
  }
  return body
}

/** Create a storable, non-serial product for stock / POS flows. */
export async function createE2eProduct(api: APIRequestContext, name: string) {
  const res = await api.post('/api/products', {
    data: {
      name,
      category: 'Accessories',
      salePrice: 1160,
      costPrice: 600,
      taxRate: 16,
      minStock: 1,
      productKind: 'storable',
      trackingMethod: 'QUANTITY',
      trackStock: true,
    },
  })
  const body = await jsonOrThrow(res, 'create product')
  expect(body.id).toBeTruthy()
  return body as { id: string; name: string; sku: string }
}

/** Create a vendor contact (unique phone avoids upsert-on-phone). */
export async function createE2eVendor(api: APIRequestContext, name: string) {
  const phone = `07${String(Date.now()).slice(-8)}`
  const res = await api.post('/api/contacts', {
    data: {
      name,
      type: 'company',
      isVendor: true,
      isCustomer: false,
      phone,
      email: `${e2eTag('vendor')}@deed.test`,
    },
  })
  const body = await jsonOrThrow(res, 'create vendor')
  expect(body.id).toBeTruthy()
  return body as { id: string; name: string }
}

/** Best-effort soft cancel of a blob repair so suites leave fewer open jobs. */
export async function cancelRepair(api: APIRequestContext, repairId: string) {
  await api.patch(`/api/repairs/${repairId}`, {
    data: { status: 'cancelled', notes: 'e2e cleanup' },
  }).catch(() => {})
}

/** Best-effort product archive/delete after stock is cleared. */
export async function cleanupProduct(api: APIRequestContext, productId: string) {
  await api.patch(`/api/products/${productId}`, { data: { isActive: false } }).catch(() => {})
  await api.delete(`/api/products/${productId}`).catch(() => {})
}
