/**
 * Deed ERP serialized-device inventory label — 100mm × 60mm landscape thermal sticker.
 * Browser print via window.print(); one label per page.
 */

import QRCode from 'qrcode'
import {
  buildSerialDeviceLabelView,
  buildSerialDeviceQrUrl,
  type SerialDeviceLabelInput,
  type SerialDeviceLabelView,
} from '@/lib/inventory/serial-device-label-data'
import { getStoredCompanyData } from '@/lib/company'

export type { SerialDeviceLabelInput, SerialDeviceLabelView } from '@/lib/inventory/serial-device-label-data'
export { buildSerialDeviceLabelView, buildSerialDeviceQrUrl } from '@/lib/inventory/serial-device-label-data'

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
      width: 2,
      height: 52,
      displayValue: false,
      margin: 6,
      background: '#FFFFFF',
      lineColor: '#0F172A',
    })
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

async function qrDataUrl(value: string): Promise<string> {
  if (typeof window === 'undefined' || !value.trim()) return ''
  try {
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 180,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
  } catch {
    return ''
  }
}

/** Minimal line icons (stroke) — thermal-safe, no emoji. */
const ICONS = {
  cpu: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#1A1F5E" stroke-width="1.8"><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 1v3M12 1v3M15 1v3M9 20v3M12 20v3M15 20v3M1 9h3M1 12h3M1 15h3M20 9h3M20 12h3M20 15h3"/></svg>`,
  ram: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#1A1F5E" stroke-width="1.8"><rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 17v2M10 17v2M14 17v2M18 17v2M6 5v2M10 5v2M14 5v2M18 5v2"/></svg>`,
  storage: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#1A1F5E" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M7 8h4M7 12h10M7 16h6"/></svg>`,
  display: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#1A1F5E" stroke-width="1.8"><rect x="2" y="4" width="20" height="13" rx="1"/><path d="M8 21h8M12 17v4"/></svg>`,
}

function labelHtml(view: SerialDeviceLabelView, barcodeSrc: string, qrSrc: string): string {
  const showBadge = view.statusBadge && view.statusBadge !== '—'
  return `
  <div class="label">
    <header class="hdr">
      <div class="brand">
        <div class="brand-mark">D</div>
        <div class="brand-copy">
          <div class="brand-name">DEED ERP</div>
          <div class="brand-sub">INVENTORY</div>
        </div>
      </div>
      <div class="title-block">
        <div class="model">${esc(view.productName)}</div>
        <div class="subtitle">${esc(view.subtitle)}</div>
      </div>
      ${showBadge ? `<div class="badge"><span class="badge-dot"></span>${esc(view.statusBadge)}</div>` : '<div class="badge-spacer"></div>'}
    </header>

    <section class="specs" aria-label="Specifications">
      <div class="spec">
        <div class="spec-top">${ICONS.cpu}<span>CPU</span></div>
        <div class="spec-val">${esc(view.cpu)}</div>
      </div>
      <div class="spec">
        <div class="spec-top">${ICONS.ram}<span>RAM</span></div>
        <div class="spec-val">${esc(view.ram)}</div>
      </div>
      <div class="spec">
        <div class="spec-top">${ICONS.storage}<span>STORAGE</span></div>
        <div class="spec-val">${esc(view.storage)}</div>
      </div>
      <div class="spec">
        <div class="spec-top">${ICONS.display}<span>DISPLAY</span></div>
        <div class="spec-val">${esc(view.display)}</div>
      </div>
    </section>

    <section class="body">
      <div class="serial-col">
        <div class="field-label">SERIAL NUMBER</div>
        <div class="serial-num">${esc(view.serial)}</div>
        <div class="barcode-wrap">
          ${barcodeSrc
            ? `<img src="${barcodeSrc}" alt="${esc(view.barcodeValue)}" class="barcode-img" />`
            : `<div class="barcode-fallback">${esc(view.barcodeValue)}</div>`}
        </div>
      </div>
      <div class="qr-col">
        ${qrSrc
          ? `<img src="${qrSrc}" alt="Device QR" class="qr-img" />`
          : `<div class="qr-fallback">QR</div>`}
      </div>
      <div class="meta-col">
        <div class="meta"><span>CONDITION</span><strong>${esc(view.condition)}</strong></div>
        <div class="meta"><span>WARRANTY</span><strong>${esc(view.warranty)}</strong></div>
        <div class="meta"><span>DATE IN</span><strong>${esc(view.dateIn)}</strong></div>
        <div class="meta"><span>LOCATION</span><strong>${esc(view.location)}</strong></div>
      </div>
    </section>

    <footer class="ftr">
      <span>${esc(view.website)}</span>
      <span class="ftr-sep">·</span>
      <span>${esc(view.phone)}</span>
    </footer>
  </div>`
}

const LABEL_CSS = `
  @page { size: 100mm 60mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100mm;
    height: 60mm;
    background: #FFFFFF;
    color: #0F172A;
    font-family: var(--font-dm-mono), ui-monospace, monospace;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { width: 100mm; height: 60mm; }
  .label {
    width: 100mm;
    height: 60mm;
    padding: 2.2mm 2.6mm 0;
    display: flex;
    flex-direction: column;
    background: #FFFFFF;
    border: 0.2mm solid #CBD5E1;
    overflow: hidden;
    page-break-after: always;
  }
  .label:last-child { page-break-after: auto; }

  .hdr {
    display: grid;
    grid-template-columns: 22mm minmax(0, 1fr) auto;
    gap: 2mm;
    align-items: start;
    min-height: 11mm;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 1.2mm;
    background: #1A1F5E;
    color: #FFFFFF;
    border-radius: 0 0 0.5rem 0;
    padding: 1.2mm 1.6mm;
    margin: -2.2mm 0 0 -2.6mm;
    min-height: 10mm;
  }
  .brand-mark {
    width: 5.5mm;
    height: 5.5mm;
    border: 0.35mm solid #FFFFFF;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 7pt;
    font-weight: 900;
    line-height: 1;
  }
  .brand-name { font-size: 6.5pt; font-weight: 900; letter-spacing: 0.2pt; line-height: 1.05; }
  .brand-sub { font-size: 4.2pt; font-weight: 700; letter-spacing: 0.8pt; opacity: 0.9; margin-top: 0.3mm; }

  .title-block { min-width: 0; padding-top: 0.4mm; }
  .model {
    font-size: 9.5pt;
    font-weight: 900;
    letter-spacing: -0.2pt;
    line-height: 1.05;
    color: #0F172A;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtitle {
    margin-top: 0.6mm;
    font-size: 5.5pt;
    font-weight: 800;
    color: #1A1F5E;
    letter-spacing: 0.4pt;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 1mm;
    background: #1A1F5E;
    color: #FFFFFF;
    border-radius: 0.5rem;
    padding: 1mm 1.8mm;
    font-size: 5pt;
    font-weight: 800;
    letter-spacing: 0.4pt;
    white-space: nowrap;
    margin-top: 0.4mm;
  }
  .badge-dot {
    width: 1.6mm;
    height: 1.6mm;
    border-radius: 0.5rem;
    background: #FFFFFF;
  }
  .badge-spacer { width: 1mm; }

  .specs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    margin-top: 1.6mm;
    border-top: 0.25mm solid #CBD5E1;
    border-bottom: 0.25mm solid #CBD5E1;
    padding: 1.3mm 0;
  }
  .spec {
    padding: 0 1.4mm;
    border-right: 0.25mm solid #CBD5E1;
    min-width: 0;
  }
  .spec:first-child { padding-left: 0; }
  .spec:last-child { border-right: none; padding-right: 0; }
  .spec-top {
    display: flex;
    align-items: center;
    gap: 0.8mm;
    font-size: 4.4pt;
    font-weight: 800;
    color: #1A1F5E;
    letter-spacing: 0.45pt;
  }
  .spec-top svg { flex-shrink: 0; }
  .spec-val {
    margin-top: 0.6mm;
    font-size: 6.2pt;
    font-weight: 900;
    color: #0F172A;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .body {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) 18mm minmax(0, 1fr);
    gap: 2mm;
    align-items: stretch;
    padding: 1.6mm 0 1.2mm;
    min-height: 0;
  }
  .serial-col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 0.25mm solid #CBD5E1;
    padding-right: 2mm;
  }
  .field-label {
    font-size: 4.4pt;
    font-weight: 800;
    color: #1A1F5E;
    letter-spacing: 0.5pt;
  }
  .serial-num {
    margin-top: 0.4mm;
    font-size: 10pt;
    font-weight: 900;
    color: #0F172A;
    letter-spacing: 0.15pt;
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .barcode-wrap {
    margin-top: auto;
    padding-top: 1mm;
    background: #FFFFFF;
  }
  .barcode-img {
    width: 100%;
    height: 11mm;
    object-fit: fill;
    image-rendering: crisp-edges;
  }
  .barcode-fallback {
    font-size: 7pt;
    font-weight: 800;
    border: 0.3mm dashed #CBD5E1;
    padding: 2mm;
    text-align: center;
  }

  .qr-col {
    display: flex;
    align-items: center;
    justify-content: center;
    border-right: 0.25mm solid #CBD5E1;
    padding: 0 1mm;
    background: #FFFFFF;
  }
  .qr-img {
    width: 16mm;
    height: 16mm;
    object-fit: contain;
    image-rendering: crisp-edges;
  }
  .qr-fallback {
    width: 16mm;
    height: 16mm;
    border: 0.3mm dashed #CBD5E1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 6pt;
    font-weight: 800;
    color: #64748B;
  }

  .meta-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.2mm 2mm;
    align-content: center;
    min-width: 0;
  }
  .meta span {
    display: block;
    font-size: 4.2pt;
    font-weight: 800;
    color: #1A1F5E;
    letter-spacing: 0.4pt;
  }
  .meta strong {
    display: block;
    margin-top: 0.35mm;
    font-size: 6pt;
    font-weight: 900;
    color: #0F172A;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ftr {
    margin: 0 -2.6mm 0;
    background: #1A1F5E;
    color: #FFFFFF;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5mm;
    min-height: 5.2mm;
    font-size: 5pt;
    font-weight: 700;
    letter-spacing: 0.2pt;
  }
  .ftr-sep { opacity: 0.7; }

  @media print {
    html, body, .sheet, .label { width: 100mm; height: 60mm; }
    .label { border: none; }
  }
`

export type PrintSerialDeviceLabelSource = Omit<SerialDeviceLabelInput, 'qrUrl' | 'website' | 'phone'> & {
  qrUrl?: string
  website?: string | null
  phone?: string | null
}

/**
 * Print one or more 100×60mm serialized-device labels.
 * Pass `currentConfig` from getDeviceConfiguration / API so RAM & storage reflect reconfiguration.
 */
export async function printSerialDeviceLabels(items: PrintSerialDeviceLabelSource[]): Promise<void> {
  if (!items.length || typeof window === 'undefined') return

  const company = getStoredCompanyData()
  const origin = window.location.origin

  const blocks = await Promise.all(items.map(async item => {
    const qrUrl = item.qrUrl || buildSerialDeviceQrUrl({
      origin,
      serialId: item.serialId,
      serial: item.serial,
    })
    const view = buildSerialDeviceLabelView({
      ...item,
      qrUrl,
      website: item.website ?? company.website ?? 'shop.deed.africa',
      phone: item.phone ?? company.phone ?? '+254 716 964 964',
    })
    const barcodeSrc = barcodeDataUrl(view.barcodeValue)
    const qrSrc = await qrDataUrl(view.qrUrl)
    return labelHtml(view, barcodeSrc, qrSrc)
  }))

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

  const win = window.open('', '_blank', 'width=900,height=640')
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
