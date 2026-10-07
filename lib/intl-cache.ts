/**
 * Reusable Intl formatters.
 *
 * `date.toLocaleDateString('en-KE', {...})` and `n.toLocaleString('en-KE', {...})`
 * build a new formatter on every call — roughly 0.1–0.5 ms each. Lists format
 * thousands of dates and amounts per render, which made fmtDate alone cost
 * close to a second of main-thread time on the Sales page. Formatters here are
 * built once per (locale, options) and reused; output is identical.
 */

const dateFormats = new Map<string, Intl.DateTimeFormat>()
const numberFormats = new Map<string, Intl.NumberFormat>()

function dateFormatter(locale: string | undefined, options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  let f = dateFormats.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    dateFormats.set(key, f)
  }
  return f
}

function numberFormatter(locale: string | undefined, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  let f = numberFormats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, options)
    numberFormats.set(key, f)
  }
  return f
}

const KE_DATE = { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' } as const
const KE_DATE_TIME = { ...KE_DATE, hour: '2-digit', minute: '2-digit', hour12: false } as const

/** "05 Oct 2026" in Nairobi time; the input back unchanged when it is not a date. */
export function formatKeDate(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return dateFormatter('en-KE', KE_DATE).format(d)
}

export function formatKeDateTime(d: Date): string {
  return dateFormatter('en-KE', KE_DATE_TIME).format(d)
}

/** Whole number with en-KE grouping: 1,234,567. */
export const formatKeInteger = (n: number) => numberFormatter('en-KE').format(n)

/** Two decimals with en-KE grouping: 1,234.50. */
export const formatKe2dp = (n: number) => numberFormatter('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

// ── Shared cache behind toLocale*String ─────────────────────────────────────
// 250+ call sites format with `x.toLocaleString(locale, options)`. Rather than
// rewrite each, the browser's methods are wrapped once at start-up to reuse a
// cached Intl formatter. The defaults follow ECMA-402 ToDateTimeOptions, so
// the strings are exactly what the built-ins return (__tests__/intl-cache.test.ts).

const DATE_FIELDS = ['weekday', 'year', 'month', 'day'] as const
const TIME_FIELDS = ['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits'] as const

function withDateDefaults(
  options: Intl.DateTimeFormatOptions | undefined,
  required: 'date' | 'time' | 'any',
  defaults: 'date' | 'time' | 'all',
): Intl.DateTimeFormatOptions {
  const o: Record<string, unknown> = { ...(options ?? {}) }
  let need = true
  if (required !== 'time' && DATE_FIELDS.some(k => o[k] !== undefined)) need = false
  if (required !== 'date' && TIME_FIELDS.some(k => o[k] !== undefined)) need = false
  if (need && defaults !== 'time') Object.assign(o, { year: 'numeric', month: 'numeric', day: 'numeric' })
  if (need && defaults !== 'date') Object.assign(o, { hour: 'numeric', minute: 'numeric', second: 'numeric' })
  return o as Intl.DateTimeFormatOptions
}

const plainOptions = (o: unknown) => o === undefined || (o !== null && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype)
const simpleLocales = (l: unknown) => l === undefined || typeof l === 'string'

let installed = false

export function installIntlFormatCache(): void {
  if (installed || typeof Intl === 'undefined') return
  installed = true
  const dateProto = Date.prototype as Date & Record<string, unknown>
  const numberProto = Number.prototype

  const wrapDate = (name: 'toLocaleString' | 'toLocaleDateString' | 'toLocaleTimeString', required: 'date' | 'time' | 'any', defaults: 'date' | 'time' | 'all') => {
    const original = dateProto[name] as (this: Date, l?: unknown, o?: unknown) => string
    Object.defineProperty(Date.prototype, name, {
      configurable: true,
      writable: true,
      value: function (this: Date, locales?: string, options?: Intl.DateTimeFormatOptions) {
        const opts = options as Record<string, unknown> | undefined
        if (!simpleLocales(locales) || !plainOptions(options) || opts?.dateStyle !== undefined || opts?.timeStyle !== undefined
          || !(this instanceof Date) || Number.isNaN(this.getTime())) {
          return original.call(this, locales, options)
        }
        return dateFormatter(locales, withDateDefaults(options, required, defaults)).format(this)
      },
    })
  }
  wrapDate('toLocaleString', 'any', 'all')
  wrapDate('toLocaleDateString', 'date', 'date')
  wrapDate('toLocaleTimeString', 'time', 'time')

  const numberOriginal = numberProto.toLocaleString
  Object.defineProperty(Number.prototype, 'toLocaleString', {
    configurable: true,
    writable: true,
    value: function (this: number, locales?: string, options?: Intl.NumberFormatOptions) {
      if (!simpleLocales(locales) || !plainOptions(options)) return numberOriginal.call(this, locales, options)
      return numberFormatter(locales, options ?? {}).format(Number(this))
    },
  })
}
