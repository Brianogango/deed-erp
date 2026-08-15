/**
 * POS thermal-receipt print helpers.
 * Display-only: never writes invoices, repairs, or company settings.
 */

export const PACKAGED_POS_RECEIPT_LOGO = '/deed-logo.svg'

export function isWalkInCustomerName(name?: string | null): boolean {
  const normalized = (name || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  return !normalized || normalized === 'walk in' || normalized === 'walk in customer'
}

/** Prefer the packaged SVG — `/deed-logo.png` is not in the repo and 404s. */
export function receiptLogoSrc(logoUrl?: string | null): string {
  const url = (logoUrl || '').trim()
  if (!url) return PACKAGED_POS_RECEIPT_LOGO
  if (url === '/deed-logo.png' || url.endsWith('/deed-logo.png')) return PACKAGED_POS_RECEIPT_LOGO
  return url
}

export type InvoiceCustomerHint = {
  id?: string
  ref?: string
  partnerName?: string
  notes?: string
}

/**
 * Buyer on the ticket, then the linked invoice party if the till was charged
 * as walk-in. Read-only — does not patch stored tickets or invoices.
 */
export function resolvePosReceiptCustomer(
  order: { customerName?: string | null; invoiceId?: string; invoiceRef?: string; ref?: string },
  invoices: InvoiceCustomerHint[] = [],
): string {
  const own = (order.customerName || '').trim()
  if (own && !isWalkInCustomerName(own)) return own

  const inv = invoices.find(row =>
    Boolean(order.invoiceId && row.id === order.invoiceId)
    || Boolean(order.invoiceRef && row.ref === order.invoiceRef)
    || Boolean(order.ref && typeof row.notes === 'string' && row.notes.includes(order.ref)),
  )
  const partner = (inv?.partnerName || '').trim()
  if (partner && !isWalkInCustomerName(partner)) return partner

  return own || 'Walk-in Customer'
}

/**
 * Rasterize the logo to a near-black PNG so thermal / Save-as-PDF actually
 * prints it. CSS filters on `<img>` are dropped by many print pipelines.
 */
export async function darkenLogoForThermalPrint(src: string): Promise<string> {
  if (typeof window === 'undefined' || typeof Image === 'undefined' || typeof document === 'undefined') {
    return src
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      const timer = window.setTimeout(() => reject(new Error('logo timeout')), 4000)
      el.onload = () => { window.clearTimeout(timer); resolve(el) }
      el.onerror = () => { window.clearTimeout(timer); reject(new Error('logo failed')) }
      el.src = src
    })
    const width = Math.max(1, img.naturalWidth || img.width)
    const height = Math.max(1, img.naturalHeight || img.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return src
    ctx.drawImage(img, 0, 0, width, height)
    const pixels = ctx.getImageData(0, 0, width, height)
    const data = pixels.data
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha === 0) continue
      const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      // Push midtones down so cyan/navy marks read as black on 80mm paper.
      const dark = Math.max(0, Math.min(255, (gray - 40) * 0.42))
      data[i] = dark
      data[i + 1] = dark
      data[i + 2] = dark
      data[i + 3] = alpha > 20 ? 255 : alpha
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return src
  }
}
