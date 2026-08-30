/**
 * Central request/input hardening for Deed ERP.
 *
 * This module is intentionally runtime-agnostic so it can be used from
 * Next.js middleware (Edge runtime) and server route handlers.
 */

export class InputSecurityError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'unsafe_input') {
    super(message)
    this.name = 'InputSecurityError'
    this.status = status
    this.code = code
  }
}

export type JsonSafetyLimits = {
  maxDepth: number
  maxNodes: number
  maxArrayLength: number
  maxObjectKeys: number
  maxKeyLength: number
  maxStringLength: number
}

export const DEFAULT_JSON_SAFETY_LIMITS: JsonSafetyLimits = {
  maxDepth: 20,
  maxNodes: 100_000,
  maxArrayLength: 20_000,
  maxObjectKeys: 2_000,
  maxKeyLength: 160,
  maxStringLength: 2_000_000,
}

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const UNSAFE_CONTROL_CHARS = /[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/

function fail(message: string, status = 400, code = 'unsafe_input'): never {
  throw new InputSecurityError(message, status, code)
}

function assertSafeString(value: string, label: string, maxLength: number) {
  if (value.length > maxLength) {
    fail(`${label} is too long`, 413, 'input_too_large')
  }
  if (UNSAFE_CONTROL_CHARS.test(value)) {
    fail(`${label} contains unsafe control characters`, 400, 'unsafe_control_character')
  }
}

export function assertSafeJsonValue(
  value: unknown,
  partialLimits: Partial<JsonSafetyLimits> = {},
  label = 'input',
): void {
  const limits = { ...DEFAULT_JSON_SAFETY_LIMITS, ...partialLimits }
  let nodes = 0

  const walk = (current: unknown, depth: number, path: string) => {
    nodes += 1
    if (nodes > limits.maxNodes) fail(`${label} contains too many values`, 413, 'input_too_complex')
    if (depth > limits.maxDepth) fail(`${label} is nested too deeply`, 400, 'input_too_deep')

    if (
      current === null
      || typeof current === 'boolean'
      || typeof current === 'undefined'
    ) return

    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail(`${path} must be a finite number`, 400, 'invalid_number')
      return
    }

    if (typeof current === 'string') {
      assertSafeString(current, path, limits.maxStringLength)
      return
    }

    if (Array.isArray(current)) {
      if (current.length > limits.maxArrayLength) {
        fail(`${path} contains too many items`, 413, 'array_too_large')
      }
      for (let i = 0; i < current.length; i += 1) walk(current[i], depth + 1, `${path}[${i}]`)
      return
    }

    if (typeof current === 'object') {
      const proto = Object.getPrototypeOf(current)
      if (proto !== Object.prototype && proto !== null) {
        fail(`${path} must be a plain object`, 400, 'invalid_object')
      }
      const entries = Object.entries(current as Record<string, unknown>)
      if (entries.length > limits.maxObjectKeys) {
        fail(`${path} contains too many fields`, 413, 'object_too_large')
      }
      for (const [key, child] of entries) {
        assertSafeString(key, `${path} field name`, limits.maxKeyLength)
        if (FORBIDDEN_OBJECT_KEYS.has(key)) {
          fail(`${path} contains a forbidden field name`, 400, 'prototype_pollution_key')
        }
        walk(child, depth + 1, path ? `${path}.${key}` : key)
      }
      return
    }

    fail(`${path} contains an unsupported value type`, 400, 'unsupported_input_type')
  }

  walk(value, 0, label)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export type SafeJsonReadOptions = {
  maxBytes?: number
  limits?: Partial<JsonSafetyLimits>
  requireJsonContentType?: boolean
}

export async function readSafeJson<T = unknown>(
  request: Request,
  options: SafeJsonReadOptions = {},
): Promise<T> {
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  if (
    options.requireJsonContentType
    && contentType
    && !contentType.includes('application/json')
    && !contentType.includes('+json')
  ) {
    fail('Content-Type must be application/json', 415, 'unsupported_media_type')
  }

  const declaredLength = Number(request.headers.get('content-length') || '0')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    fail('Request body is too large', 413, 'payload_too_large')
  }

  const raw = await request.text()
  if (byteLength(raw) > maxBytes) fail('Request body is too large', 413, 'payload_too_large')
  if (!raw.trim()) fail('Request body is required', 400, 'empty_body')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail('Invalid JSON', 400, 'invalid_json')
  }

  assertSafeJsonValue(parsed, options.limits, 'request body')
  return parsed as T
}

export function assertSafeRequestUrl(request: Request): void {
  if (request.url.length > 16_384) fail('Request URL is too long', 414, 'url_too_long')

  const url = new URL(request.url)
  if (url.pathname.length > 2_048) fail('Request path is too long', 414, 'path_too_long')

  for (const segment of url.pathname.split('/')) {
    if (segment.length > 512) fail('Request path segment is too long', 414, 'path_segment_too_long')
    assertSafeString(segment, 'request path', 512)
  }

  let parameterCount = 0
  for (const [key, value] of url.searchParams.entries()) {
    parameterCount += 1
    if (parameterCount > 200) fail('Too many query parameters', 400, 'too_many_query_parameters')
    assertSafeString(key, 'query parameter name', 160)
    assertSafeString(value, `query parameter "${key}"`, 8_192)
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      fail('Forbidden query parameter name', 400, 'prototype_pollution_key')
    }
  }
}

function requestBodyLimit(pathname: string, contentType: string): number {
  // The legacy state sync can legitimately carry several collections at once.
  if (pathname === '/api/store') return 12 * 1024 * 1024
  if (pathname.startsWith('/api/products/bulk')) return 8 * 1024 * 1024
  if (
    pathname.includes('/payment-proof')
    || pathname.includes('/payment-confirmation')
    || contentType.includes('multipart/form-data')
  ) return 12 * 1024 * 1024
  return 4 * 1024 * 1024
}

export async function assertSafeRequestEnvelope(request: Request): Promise<void> {
  assertSafeRequestUrl(request)

  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return

  const url = new URL(request.url)
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  const maxBytes = requestBodyLimit(url.pathname, contentType)
  const declaredLength = Number(request.headers.get('content-length') || '0')

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    fail('Request body is too large', 413, 'payload_too_large')
  }

  // Inspect JSON centrally so every API route gets structural protection,
  // including routes that predate Zod schemas. A clone is used so the route
  // handler still receives the original body stream.
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    await readSafeJson(request.clone(), { maxBytes })
    return
  }

  // URL-encoded user input receives the same key/value controls.
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = await request.clone().text()
    if (byteLength(raw) > maxBytes) fail('Request body is too large', 413, 'payload_too_large')
    const params = new URLSearchParams(raw)
    let count = 0
    for (const [key, value] of params.entries()) {
      count += 1
      if (count > 500) fail('Too many form fields', 400, 'too_many_form_fields')
      assertSafeString(key, 'form field name', 160)
      assertSafeString(value, `form field "${key}"`, 250_000)
      if (FORBIDDEN_OBJECT_KEYS.has(key)) fail('Forbidden form field name', 400, 'prototype_pollution_key')
    }
    return
  }

  if (contentType.includes('multipart/form-data')) return

  // Do not trust Content-Type as a security boundary. Some third-party
  // callbacks legitimately send JSON as text/plain, and a hostile caller can
  // deliberately mislabel JSON to try to skip structural checks.
  const raw = await request.clone().text()
  if (!raw) return
  if (byteLength(raw) > maxBytes) fail('Request body is too large', 413, 'payload_too_large')
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      fail('Invalid JSON payload', 400, 'invalid_json')
    }
    assertSafeJsonValue(parsed, {}, 'request body')
  } else {
    assertSafeString(raw, 'request body', maxBytes)
  }
}

export function assertSameOriginBrowserWrite(request: Request): void {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return

  const secFetchSite = (request.headers.get('sec-fetch-site') || '').toLowerCase()
  if (secFetchSite === 'cross-site') {
    fail('Cross-site write request blocked', 403, 'cross_site_write')
  }

  const origin = request.headers.get('origin')
  if (!origin) return

  let supplied: URL
  try {
    supplied = new URL(origin)
  } catch {
    fail('Invalid request origin', 403, 'invalid_origin')
  }

  const requestUrl = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || request.headers.get('host')
    || requestUrl.host
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || requestUrl.protocol.replace(':', '')
  const expectedOrigin = `${forwardedProto}://${forwardedHost}`

  if (supplied.origin !== expectedOrigin && supplied.origin !== requestUrl.origin) {
    fail('Cross-origin write request blocked', 403, 'origin_mismatch')
  }
}

export function inputSecurityResponse(error: unknown): Response | null {
  if (!(error instanceof InputSecurityError)) return null
  return new Response(
    JSON.stringify({ error: error.message, code: error.code }),
    {
      status: error.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
}

/**
 * Validate a legacy serialized app-state value. String values may themselves
 * contain JSON; when they do, inspect the decoded value too so nested payloads
 * cannot bypass the middleware by being double-encoded.
 */
export function assertSafeStoreValue(value: unknown, label = 'store value'): void {
  assertSafeJsonValue(value, {
    maxDepth: 24,
    maxNodes: 150_000,
    maxArrayLength: 30_000,
    maxObjectKeys: 3_000,
    maxStringLength: 4_000_000,
  }, label)

  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!trimmed) return
  if (!['{', '[', '"', '-', 't', 'f', 'n'].includes(trimmed[0]) && !/^\d/.test(trimmed[0])) return

  try {
    const decoded = JSON.parse(trimmed)
    assertSafeJsonValue(decoded, {
      maxDepth: 24,
      maxNodes: 150_000,
      maxArrayLength: 30_000,
      maxObjectKeys: 3_000,
      maxStringLength: 2_000_000,
    }, `${label} (decoded)`)
  } catch (error) {
    if (error instanceof InputSecurityError) throw error
    // Some legacy scalar string values are not JSON. They remain safe after
    // the outer string checks above, so keep backward compatibility.
  }
}

export function normalizePlainText(value: unknown, maxLength = 10_000): string {
  const text = String(value ?? '').normalize('NFKC').trim()
  assertSafeString(text, 'text value', maxLength)
  return text
}
