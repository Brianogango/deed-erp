#!/usr/bin/env node
const baseUrl = process.env.ERP_HEALTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
const internalSecret = process.env.INTERNAL_API_SECRET
const url = new URL('/api/health', baseUrl)
const attempts = Number(process.env.ERP_HEALTH_ATTEMPTS || 10)
const delayMs = Number(process.env.ERP_HEALTH_DELAY_MS || 1000)

const started = Date.now()
let res
let body = {}
let lastError

for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    res = await fetch(url, {
      headers: internalSecret ? { 'x-internal-secret': internalSecret } : undefined,
    })
    body = await res.json().catch(() => ({}))
    if (res.ok && body.ok === true) break
  } catch (error) {
    lastError = error
  }
  if (attempt < attempts) {
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}

const elapsed = Date.now() - started

if (!res?.ok || body.ok !== true) {
  console.error(JSON.stringify({ ok: false, status: res?.status ?? 0, elapsedMs: elapsed, body, error: lastError instanceof Error ? lastError.message : undefined }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, status: res.status, elapsedMs: elapsed, body }, null, 2))
