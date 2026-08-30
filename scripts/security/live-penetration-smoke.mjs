#!/usr/bin/env node

import 'dotenv/config'

const base = String(process.env.SECURITY_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.argv[2] || '').replace(/\/$/, '')
if (!base || !base.startsWith('https://')) {
  console.error('SECURITY_BASE_URL or NEXT_PUBLIC_APP_URL must be an https:// production URL')
  process.exit(2)
}

const passes = []
const failures = []
const warnings = []

function expect(condition, label, detail = '') {
  if (condition) passes.push(label)
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

async function request(path, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    return await fetch(`${base}${path}`, { redirect: 'manual', ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function cookieHeaderFrom(response) {
  const all = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || '']
  const session = all.find(value => /(?:^|;|\s)deed-session=/.test(value) || value.startsWith('deed-session=')) || ''
  const pair = session.split(';', 1)[0]
  return { raw: session, pair }
}

try {
  const loginPage = await request('/login')
  expect(loginPage.status === 200, 'HTTPS login page reachable', `status ${loginPage.status}`)
  const h = loginPage.headers
  expect((h.get('strict-transport-security') || '').includes('max-age=31536000'), 'HSTS enforced')
  const csp = h.get('content-security-policy') || ''
  expect(csp.includes("default-src 'self'"), 'CSP default-src self')
  expect(csp.includes("object-src 'none'"), 'CSP blocks plugins')
  expect(csp.includes("frame-ancestors 'none'"), 'CSP blocks framing')
  expect(h.get('x-content-type-options') === 'nosniff', 'MIME sniffing disabled')
  expect(h.get('x-frame-options') === 'DENY', 'legacy framing protection present')

  const anonymousTargets = ['/api/store', '/api/users', '/api/accounting/journals', '/api/admin/reset']
  for (const path of anonymousTargets) {
    const response = await request(path)
    expect(response.status === 401, `Anonymous access denied: ${path}`, `status ${response.status}`)
  }

  const malformed = await request('/api/store', { headers: { Authorization: 'Bearer %E0%A4%A' } })
  expect(malformed.status === 401, 'Malformed Bearer token fails closed', `status ${malformed.status}`)

  const setup = await request('/api/setup-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Security-Smoke-Only-Strong-2026!' }),
  })
  expect(setup.status === 503, 'One-time bootstrap is disabled in production', `status ${setup.status}`)

  const unknownLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `security-probe-${Date.now()}`, password: 'invalid-security-probe' }),
  })
  expect(unknownLogin.status === 401, 'Unknown login returns generic unauthorized status', `status ${unknownLogin.status}`)

  const polluted = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"username":"nobody","password":"x","__proto__":{"role":"director"}}',
  })
  expect([400, 401].includes(polluted.status), 'Prototype-pollution login payload rejected', `status ${polluted.status}`)

  const partnerCors = await request('/api/public/v1/products', { headers: { Origin: 'https://evil.example' } })
  expect(!partnerCors.headers.get('access-control-allow-origin'), 'Unknown partner CORS origin not reflected')

  const username = String(process.env.SECURITY_TEST_USERNAME || '')
  const password = String(process.env.SECURITY_TEST_PASSWORD || '')
  const expectedRole = String(process.env.SECURITY_TEST_EXPECTED_ROLE || 'sales_rep')

  if (username && password) {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const loginBody = await login.json().catch(() => ({}))
    expect(login.status === 200 && !loginBody.mfaRequired, 'Low-privilege security test account can authenticate', `status ${login.status}`)
    expect(loginBody?.user?.role === expectedRole, 'Security test account role matches expected low privilege', `role ${loginBody?.user?.role}`)

    const sessionCookie = cookieHeaderFrom(login)
    expect(Boolean(sessionCookie.pair), 'ERP session cookie issued')
    expect(/HttpOnly/i.test(sessionCookie.raw), 'Session cookie is HttpOnly')
    expect(/Secure/i.test(sessionCookie.raw), 'Session cookie is Secure')
    expect(/SameSite=Lax/i.test(sessionCookie.raw), 'Session cookie uses SameSite=Lax')

    if (sessionCookie.pair) {
      const authHeaders = { Cookie: sessionCookie.pair }
      const users = await request('/api/users', { headers: authHeaders })
      expect(users.status === 403, 'Low-privilege account cannot enumerate system users', `status ${users.status}`)

      const journals = await request('/api/accounting/journals', { headers: authHeaders })
      expect(journals.status === 403, 'Low-privilege account cannot read accounting journals', `status ${journals.status}`)

      const adminReset = await request('/api/admin/reset', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'RESET DEED ERP PRODUCTION DATA' }),
      })
      expect(adminReset.status === 403, 'Low-privilege account cannot invoke Director reset', `status ${adminReset.status}`)

      const crossOrigin = await request('/api/store/deed_contacts', {
        method: 'PUT',
        headers: { ...authHeaders, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: [] }),
      })
      expect(crossOrigin.status === 403, 'Authenticated cross-origin write blocked', `status ${crossOrigin.status}`)

      const unknownStore = await request('/api/store', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deed_attackerControlled: [] }),
      })
      expect([400, 403].includes(unknownStore.status), 'Unknown app-state namespace fails closed', `status ${unknownStore.status}`)

      if (loginBody?.user?.id && expectedRole === 'sales_rep') {
        const promote = await request(`/api/users/${encodeURIComponent(loginBody.user.id)}`, {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'director', modules: ['accounting', 'hr'] }),
        })
        const promoteBody = await promote.json().catch(() => ({}))
        expect(promote.status === 200 && promoteBody?.user?.role === expectedRole, 'Self privilege escalation is discarded', `status ${promote.status}, role ${promoteBody?.user?.role}`)
      }

      const redirectProbe = await request('/login?returnTo=https%3A%2F%2Fevil.example', { headers: authHeaders })
      const location = redirectProbe.headers.get('location') || ''
      expect(!location.includes('evil.example'), 'Authenticated returnTo cannot create external redirect', location)

      await request('/api/auth/logout', { method: 'POST', headers: authHeaders }).catch(() => {})
    }
  } else {
    warnings.push('SECURITY_TEST_USERNAME/PASSWORD not configured; authenticated production probes were skipped')
  }
} catch (error) {
  failures.push(`Pentest execution failed — ${error instanceof Error ? error.message : String(error)}`)
}

console.log('Deed ERP non-destructive production security probe')
for (const pass of passes) console.log(`PASS: ${pass}`)
for (const warning of warnings) console.warn(`WARN: ${warning}`)
for (const failure of failures) console.error(`FAIL: ${failure}`)
console.log(`\n${passes.length} passed, ${warnings.length} warnings, ${failures.length} failed.`)
console.log('Excluded by design: destructive data changes, brute-force floods, raw HTTP request smuggling, malware payload execution, and DoS.')
process.exit(failures.length ? 1 : 0)
