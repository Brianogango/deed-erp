#!/usr/bin/env node

const base = String(process.env.SECURITY_BASE_URL || process.argv[2] || '').replace(/\/$/, '')
if (!base) {
  console.error('Usage: SECURITY_BASE_URL=https://erp.example.com node scripts/security/live-security-smoke.mjs')
  process.exit(2)
}
if (!base.startsWith('https://')) {
  console.error('Refusing to test a non-HTTPS production URL.')
  process.exit(2)
}

const failures = []
const passes = []

async function request(path, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(`${base}${path}`, { redirect: 'manual', ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function expect(condition, label, detail = '') {
  if (condition) passes.push(label)
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

try {
  const login = await request('/login')
  expect(login.status === 200, 'HTTPS login endpoint reachable', `status ${login.status}`)
  const h = login.headers
  expect((h.get('strict-transport-security') || '').includes('max-age='), 'HSTS present')
  expect((h.get('content-security-policy') || '').includes("default-src 'self'"), 'CSP present')
  expect(h.get('x-content-type-options') === 'nosniff', 'MIME sniffing disabled')
  expect(h.get('x-frame-options') === 'DENY', 'Framing denied')

  const unauth = await request('/api/store')
  expect(unauth.status === 401, 'Authenticated API rejects anonymous access', `status ${unauth.status}`)

  const malformedBearer = await request('/api/store', {
    headers: { Authorization: 'Bearer %E0%A4%A' },
  })
  expect(malformedBearer.status === 401, 'Malformed Bearer token fails closed', `status ${malformedBearer.status}`)

  const setup = await request('/api/setup-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect([401, 503].includes(setup.status), 'Bootstrap endpoint unavailable without setup secret', `status ${setup.status}`)

  const publicApi = await request('/api/public/v1/products')
  expect([401, 403].includes(publicApi.status), 'Partner API requires credential', `status ${publicApi.status}`)

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `security-smoke-${Date.now()}`, password: 'invalid-security-smoke-password' }),
  })
  expect(badLogin.status === 401, 'Invalid login returns generic unauthorized status', `status ${badLogin.status}`)
} catch (error) {
  failures.push(`Smoke execution failed — ${error instanceof Error ? error.message : String(error)}`)
}

console.log('Deed ERP live security smoke')
for (const label of passes) console.log(`PASS: ${label}`)
for (const label of failures) console.error(`FAIL: ${label}`)
console.log(`\n${passes.length} passed, ${failures.length} failed.`)
process.exit(failures.length ? 1 : 0)
