/**
 * What a browser tells us about the machine it runs on. Plain ESM, so the
 * ops scripts can use it with no build step.
 *
 * A browser does NOT report the computer's make or model: Windows and macOS
 * laptops identify themselves only by operating system, so the most a log can
 * honestly say is "Windows PC · Chrome". Android phones do send a model
 * (SM-A546B, Infinix X6831), and that is shown when it is there.
 */

const UNKNOWN = { browser: 'Unknown browser', os: 'Unknown OS', device: 'Unknown device', label: 'Unknown device' }

function browserOf(ua) {
  // Order matters: Edge and most Chromium browsers also claim Chrome and Safari.
  if (/Edg(?:e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox'
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Browser'
}

function versionOf(ua, browser) {
  const pattern = {
    Edge: /Edg(?:e|A|iOS)?\/(\d+)/,
    Opera: /OPR\/(\d+)/,
    'Samsung Internet': /SamsungBrowser\/(\d+)/,
    Firefox: /(?:Firefox|FxiOS)\/(\d+)/,
    Chrome: /(?:Chrome|CriOS)\/(\d+)/,
    Safari: /Version\/(\d+)/,
  }
  return pattern[browser] ? (ua.match(pattern[browser])?.[1] ?? '') : ''
}

/** The phone model Android puts in the build token, e.g. "Android 14; SM-A546B)". */
function androidModel(ua) {
  const inside = ua.match(/\(([^)]*Android[^)]*)\)/i)?.[1]
  if (!inside) return ''
  const parts = inside.split(';').map(p => p.trim())
  // "Linux; Android 14; SM-A546B Build/UP1A" — the model follows the version.
  const index = parts.findIndex(p => /^Android\b/i.test(p))
  const model = parts[index + 1]?.replace(/\s+Build\/.*$/i, '').trim()
  if (!model || /^(wv|Mobile|K)$/i.test(model)) return ''
  return model
}

/** Browser, operating system and — where the browser says so — the hardware. */
export function describeDevice(userAgent) {
  const ua = (userAgent ?? '').trim()
  if (!ua) return UNKNOWN

  const browser = browserOf(ua)
  const version = versionOf(ua, browser)
  const browserLabel = version ? `${browser} ${version}` : browser

  let os = 'Unknown OS'
  let device = 'Unknown device'
  if (/Android/i.test(ua)) {
    const version = ua.match(/Android\s+([\d.]+)/i)?.[1]
    os = version ? `Android ${version}` : 'Android'
    device = androidModel(ua) || (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
  } else if (/iPhone/i.test(ua)) {
    os = 'iOS'; device = 'iPhone'
  } else if (/iPad/i.test(ua)) {
    os = 'iPadOS'; device = 'iPad'
  } else if (/Windows NT/i.test(ua)) {
    // Windows 11 and 10 both report NT 10.0, so the version is not stated.
    os = 'Windows'; device = 'Windows PC'
  } else if (/Mac OS X/i.test(ua)) {
    os = 'macOS'; device = 'Mac'
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS'; device = 'Chromebook'
  } else if (/Linux/i.test(ua)) {
    os = 'Linux'; device = 'Linux PC'
  }

  const label = device === 'Unknown device' ? browserLabel : `${device} · ${browserLabel}`
  return { browser: browserLabel, os, device, label }
}

/** Just the one-line label, for a log row. */
export function deviceLabel(userAgent) {
  return describeDevice(userAgent).label
}
