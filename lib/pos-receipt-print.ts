/**
 * POS thermal-receipt print helpers.
 * Display-only: never writes invoices, repairs, or company settings.
 */

/** Official Deed Technologies lockup, already black on white for 80mm thermal. */
export const PACKAGED_POS_RECEIPT_LOGO = '/deed-logo-receipt.png'
const PLACEHOLDER_ERP_MARK = '/deed-logo.svg'

export function isWalkInCustomerName(name?: string | null): boolean {
  const normalized = (name || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  return !normalized || normalized === 'walk in' || normalized === 'walk in customer'
}

/**
 * Use an uploaded Settings logo when it is a real image. Never print the
 * three-bar "deed ERP SYSTEM" placeholder — that is not the company mark.
 */
export function receiptLogoSrc(logoUrl?: string | null): string {
  const url = (logoUrl || '').trim()
  if (!url) return PACKAGED_POS_RECEIPT_LOGO
  if (url.startsWith('data:image/')) return url
  // Packaged brand files: print the black-on-white lockup, never the
  // three-bar ERP mark or the dark-background 3D login art.
  if (
    url === PLACEHOLDER_ERP_MARK
    || url.endsWith('/deed-logo.svg')
    || url.endsWith('/deed-logo.png')
    || url.endsWith('/deed-logo-square.png')
    || url.endsWith('/deed-logo-inverted.png')
    || url.endsWith('/deed-logo-transparent.png')
  ) {
    return PACKAGED_POS_RECEIPT_LOGO
  }
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
      // Near-white stays paper-white; every inked pixel goes to true black.
      if (gray > 235) {
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
        data[i + 3] = 255
      } else {
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 255
      }
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return src
  }
}
