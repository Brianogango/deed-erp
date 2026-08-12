/**
 * Client-safe company logo helpers for commercial PDFs and Settings upload.
 * Server PDF loading lives in `lib/pdf-logo.server.ts` so sharp/fs never
 * enter the browser bundle via Settings / commercial-pdf.
 */

export type PdfLogo = {
  dataUrl: string
  width: number
  height: number
  format: 'PNG' | 'JPEG'
}

const FALLBACK_PUBLIC_LOGO = '/deed-logo.png'

function formatFromMime(mime: string): 'PNG' | 'JPEG' {
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG'
  return 'PNG'
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
  if (!match) return null
  return { mime: match[1] || 'image/png', base64: match[3] || '' }
}

async function dimensionsFromDataUrlClient(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return null
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      const timer = window.setTimeout(() => reject(new Error('logo timeout')), 4000)
      el.onload = () => { window.clearTimeout(timer); resolve(el) }
      el.onerror = () => { window.clearTimeout(timer); reject(new Error('logo failed')) }
      el.src = dataUrl
    })
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    if (!width || !height) return null
    return { width, height }
  } catch {
    return null
  }
}

/** Convert webp (or any) data URL to PNG via canvas when in the browser. */
async function ensureJsPdfSafeDataUrl(dataUrl: string): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null
  const mime = parsed.mime.toLowerCase()
  if (mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg')) {
    return { dataUrl, format: formatFromMime(mime) }
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = dataUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1
    canvas.height = img.naturalHeight || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), format: 'PNG' }
  } catch {
    return null
  }
}

async function loadFromUrlClient(url: string): Promise<PdfLogo | null> {
  if (typeof window === 'undefined') return null
  try {
    const abs = url.startsWith('http') || url.startsWith('data:')
      ? url
      : new URL(url, window.location.origin).toString()
    const res = await fetch(abs, { cache: 'force-cache' })
    if (!res.ok) return null
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(blob)
    })
    const safe = await ensureJsPdfSafeDataUrl(dataUrl)
    if (!safe) return null
    const dims = await dimensionsFromDataUrlClient(safe.dataUrl)
    if (!dims) return null
    return { dataUrl: safe.dataUrl, width: dims.width, height: dims.height, format: safe.format }
  } catch {
    return null
  }
}

/**
 * Browser / client PDF path. Always tries the packaged Deed logo when the
 * uploaded company logo is missing or fails to decode.
 */
export async function loadLogoForPdfClient(logoUrl?: string | null): Promise<PdfLogo | null> {
  const candidates = [logoUrl, FALLBACK_PUBLIC_LOGO].filter(Boolean) as string[]
  for (const candidate of candidates) {
    if (candidate.startsWith('data:image/')) {
      const safe = await ensureJsPdfSafeDataUrl(candidate)
      if (!safe) continue
      const dims = await dimensionsFromDataUrlClient(safe.dataUrl)
      if (!dims) continue
      return { dataUrl: safe.dataUrl, width: dims.width, height: dims.height, format: safe.format }
    }
    const loaded = await loadFromUrlClient(candidate)
    if (loaded) return loaded
  }
  return null
}

/**
 * Shrink a freshly uploaded company logo so `deed_companySettings` stays under
 * the localStorage 512KB sync ceiling (large data URLs were wiping the key and
 * making the logo "disappear" after refresh).
 */
export async function compressCompanyLogoDataUrl(
  dataUrl: string,
  opts?: { maxWidth?: number; quality?: number },
): Promise<string> {
  const maxWidth = opts?.maxWidth ?? 720
  const quality = opts?.quality ?? 0.82
  if (typeof window === 'undefined' || typeof document === 'undefined') return dataUrl

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('logo decode failed'))
      el.src = dataUrl
    })
    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    if (!srcW || !srcH) return dataUrl
    const scale = Math.min(1, maxWidth / srcW)
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, w, h)
    // Prefer JPEG for photos/logos with flat backgrounds — much smaller than PNG.
    const jpeg = canvas.toDataURL('image/jpeg', quality)
    if (jpeg.length < dataUrl.length) return jpeg
    return canvas.toDataURL('image/png')
  } catch {
    return dataUrl
  }
}
