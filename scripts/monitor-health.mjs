#!/usr/bin/env node
const baseUrl = process.env.ERP_HEALTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
const internalSecret = process.env.INTERNAL_API_SECRET
const url = new URL('/api/health', baseUrl)

const started = Date.now()
const res = await fetch(url, {
  headers: internalSecret ? { 'x-internal-secret': internalSecret } : undefined,
})
const body = await res.json().catch(() => ({}))
const elapsed = Date.now() - started

if (!res.ok || body.ok !== true) {
  console.error(JSON.stringify({ ok: false, status: res.status, elapsedMs: elapsed, body }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, status: res.status, elapsedMs: elapsed, body }, null, 2))
