/**
 * Deed ERP serialized-device inventory label — 80mm × 40mm landscape thermal sticker.
 *
 * Optimised for 203-DPI direct-thermal printers:
 * - product/model is the visual priority
 * - processor, RAM and storage are large and easy to read
 * - serial appears once, directly below the CODE128 barcode
 * - no QR, stock badge, condition, warranty or location clutter
 * - compact Deed lockup leaves maximum space for asset information
 */

import {
  buildSerialDeviceLabelView,
  type SerialDeviceLabelInput,
  type SerialDeviceLabelView,
} from '@/lib/inventory/serial-device-label-data'

export type { SerialDeviceLabelInput, SerialDeviceLabelView } from '@/lib/inventory/serial-device-label-data'
export { buildSerialDeviceLabelView, buildSerialDeviceQrUrl } from '@/lib/inventory/serial-device-label-data'

const INK = '#000000'

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function barcodeDataUrl(value: string): string {
  if (typeof window === 'undefined' || !value.trim()) return ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JsBarcode = require('jsbarcode')
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: 2.2,
      height: 52,
      displayValue: false,
      margin: 0,
      background: '#FFFFFF',
      lineColor: INK,
    })
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

function labelHtml(view: SerialDeviceLabelView, barcodeSrc: string): string {
  return `
  <div class="label">
    <header class="hdr">
      <div class="brand">
        <img src="/deed-logo-receipt.png" alt="Deed Technologies" class="brand-logo" />
      </div>
      <div class="title-block">
        <div class="model">${esc(view.productName)}</div>
      </div>
    </header>

    <div class="rule" aria-hidden="true"></div>

    <section class="specs" aria-label="Specifications">
      <div class="spec spec-cpu">
        <span class="spec-key">PROCESSOR</span>
        <strong class="spec-val">${esc(view.cpu)}</strong>
      </div>
      <div class="spec">
        <span class="spec-key">RAM</span>
        <strong class="spec-val">${esc(view.ram)}</strong>
      </div>
      <div class="spec">
        <span class="spec-key">STORAGE</span>
        <strong class="spec-val">${esc(view.storage)}</strong>
      </div>
    </section>

    <div class="rule rule-bottom" aria-hidden="true"></div>

    <section class="barcode-wrap" aria-label="Serial barcode">
      ${barcodeSrc
        ? `<img src="${barcodeSrc}" alt="${esc(view.barcodeValue)}" class="barcode-img" />`
        : `<div class="barcode-fallback">${esc(view.barcodeValue)}</div>`}
      <div class="barcode-caption">${esc(view.serial || view.barcodeValue)}</div>
    </section>
  </div>`
}

const LABEL_CSS = `
  @page { size: 80mm 40mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    width: 80mm;
    min-height: 40mm;
    background: #FFFFFF;
    color: ${INK};
    font-family: Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .sheet {
    width: 80mm;
  }

  .label {
    width: 80mm;
    height: 40mm;
    padding: 1.7mm 2.2mm 1.4mm;
    display: flex;
    flex-direction: column;
    background: #FFFFFF;
    color: ${INK};
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }

  .label:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  .hdr {
    display: grid;
    grid-template-columns: 13mm minmax(0, 1fr);
    gap: 1.7mm;
    align-items: center;
    min-height: 8.6mm;
  }

  .brand {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding-right: 1.5mm;
    border-right: 0.35mm solid #000;
  }

  .brand-logo {
    display: block;
    width: 11.5mm;
    max-height: 6.5mm;
    object-fit: contain;
    object-position: left center;
    filter: grayscale(1) contrast(1.8);
  }

  .title-block {
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .model {
    font-size: 11.5pt;
    font-weight: 900;
    line-height: 1.02;
    letter-spacing: -0.2pt;
    color: #000;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  .rule {
    flex: 0 0 auto;
    height: 0.35mm;
    background: #000;
    margin: 1mm 0 1.1mm;
  }

  .specs {
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(0, 0.75fr) minmax(0, 1fr);
    gap: 1.5mm;
    align-items: stretch;
    min-height: 9.4mm;
  }

  .spec {
    min-width: 0;
    padding-left: 1.5mm;
    border-left: 0.3mm solid #000;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .spec:first-child {
    border-left: none;
    padding-left: 0;
  }

  .spec-key {
    display: block;
    font-size: 5.8pt;
    font-weight: 900;
    letter-spacing: 0.35pt;
    line-height: 1;
    color: #000;
  }

  .spec-val {
    display: block;
    margin-top: 0.8mm;
    font-size: 8.8pt;
    font-weight: 900;
    line-height: 1.05;
    color: #000;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spec-cpu .spec-val {
    font-size: 8.3pt;
  }

  .rule-bottom {
    margin: 1mm 0 0.8mm;
  }

  .barcode-wrap {
    margin-top: auto;
    width: 100%;
    min-height: 10.2mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
  }

  .barcode-img {
    display: block;
    width: 92%;
    height: 7.1mm;
    object-fit: fill;
    image-rendering: crisp-edges;
    filter: grayscale(1) contrast(2);
  }

  .barcode-caption {
    margin-top: 0.45mm;
    max-width: 100%;
    font-size: 7pt;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0.45pt;
    text-align: center;
    color: #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .barcode-fallback {
    width: 92%;
    min-height: 7.1mm;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0.35mm solid #000;
    font-size: 8pt;
    font-weight: 900;
    text-align: center;
  }

  @media print {
    html, body, .sheet, .label {
      width: 80mm;
    }
    .label {
      height: 40mm;
    }
  }
`

export type PrintSerialDeviceLabelSource = Omit<SerialDeviceLabelInput, 'qrUrl' | 'website' | 'phone'> & {
  /** Retained for API compatibility; QR is intentionally not printed on the 80×40 label. */
  qrUrl?: string
  website?: string | null
  phone?: string | null
}

/**
 * Print one or more 80×40mm serialized-device labels.
 * Pass currentConfig so processor/RAM/storage reflect the actual unit after reconfiguration.
 */
export async function printSerialDeviceLabels(items: PrintSerialDeviceLabelSource[]): Promise<void> {
  if (!items.length || typeof window === 'undefined') return

  const blocks = items.map(item => {
    const view = buildSerialDeviceLabelView({
      ...item,
      qrUrl: item.qrUrl || '',
      website: item.website || '',
      phone: item.phone || '',
    })
    const barcodeSrc = barcodeDataUrl(view.barcodeValue)
    return labelHtml(view, barcodeSrc)
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Serial Device Labels</title>
<style>${LABEL_CSS}</style>
</head>
<body>
<div class="sheet">
${blocks.join('\n')}
</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=760,height=520')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

type DeviceConfigFieldsLite = {
  processor?: string | null
  processorGeneration?: string | null
  totalRamGb?: number
  primaryStorageGb?: number | null
  storageType?: string | null
  screenSize?: string | null
  screenResolution?: string | null
  displayName?: string
  grade?: string | null
  ramComposition?: Array<{ technology?: string }>
}

/**
 * Fetch current device configuration for a serial (snapshot wins over blob specs).
 * Returns null when the API is unavailable — caller should still print with specsText.
 */
export async function fetchSerialCurrentConfig(serialId: string): Promise<Partial<DeviceConfigFieldsLite> | null> {
  try {
    const res = await fetch(`/api/reconfiguration/device/${encodeURIComponent(serialId)}/configuration`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data?.current || data?.device?.current || null) as Partial<DeviceConfigFieldsLite> | null
  } catch {
    return null
  }
}
