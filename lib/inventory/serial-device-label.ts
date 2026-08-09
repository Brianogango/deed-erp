/**
 * Deed ERP serialized-device inventory label — 100mm × 60mm landscape thermal sticker.
 * Visual language aligned to Deed Technologies branding (navy + cyan) and the
 * repair-ticket / inventory-label comps: wordmark, cyan icons, QR callout.
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

const NAVY = '#1A1F5E'
const CYAN = '#00B0D7'

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
      height: 48,
      displayValue: false,
      margin: 8,
      background: '#FFFFFF',
      lineColor: NAVY,
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
      color: { dark: NAVY, light: '#FFFFFF' },
    })
  } catch {
    return ''
  }
}

/** Cyan line icons for the spec row (mockup). */
const SPEC_ICONS = {
  cpu: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="${CYAN}" stroke-width="1.9"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 1v3M12 1v3M15 1v3M9 20v3M12 20v3M15 20v3M1 9h3M1 12h3M1 15h3M20 9h3M20 12h3M20 15h3"/></svg>`,
  ram: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="${CYAN}" stroke-width="1.9"><rect x="2" y="7" width="20" height="10" rx="1.5"/><path d="M6 17v2M10 17v2M14 17v2M18 17v2M6 5v2M10 5v2M14 5v2M18 5v2"/></svg>`,
  storage: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="${CYAN}" stroke-width="1.9"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 8h4M7 12h10M7 16h6"/></svg>`,
  display: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="${CYAN}" stroke-width="1.9"><rect x="2" y="4" width="20" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/></svg>`,
}

/** Navy rounded tiles + white glyphs (repair-ticket field icons). */
function metaIcon(kind: 'condition' | 'warranty' | 'location'): string {
  const glyph =
    kind === 'condition'
      ? `<path d="M12 5v4M12 15v4M5 12h4M15 12h4"/><circle cx="12" cy="12" r="3"/>`
      : kind === 'warranty'
        ? `<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>`
        : `<path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>`
  return `<span class="meta-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#FFFFFF" stroke-width="2">${glyph}</svg></span>`
}

function labelHtml(view: SerialDeviceLabelView, barcodeSrc: string, qrSrc: string): string {
  const showBadge = view.statusBadge && view.statusBadge !== '—'
  return `
  <div class="label">
    <header class="hdr">
      <div class="brand">
        <div class="wordmark">
          <div class="wm-deed"><span class="wm-d">d</span>eed</div>
          <div class="wm-tech">TECHNOLOGIES</div>
        </div>
      </div>
      <div class="hdr-rule" aria-hidden="true"></div>
      <div class="title-block">
        <div class="model">${esc(view.productName)}</div>
        <div class="subtitle">${esc(view.subtitle)}</div>
      </div>
      ${showBadge ? `<div class="badge">${esc(view.statusBadge)}</div>` : '<div class="badge-spacer"></div>'}
    </header>

    <div class="rule" aria-hidden="true"></div>

    <section class="specs" aria-label="Specifications">
      <div class="spec">
        <div class="spec-top">${SPEC_ICONS.cpu}<span>CPU</span></div>
        <div class="spec-val">${esc(view.cpu)}</div>
      </div>
      <div class="spec">
        <div class="spec-top">${SPEC_ICONS.ram}<span>RAM</span></div>
        <div class="spec-val">${esc(view.ram)}</div>
      </div>
      <div class="spec">
        <div class="spec-top">${SPEC_ICONS.storage}<span>STORAGE</span></div>
        <div class="spec-val">${esc(view.storage)}</div>
      </div>
      <div class="spec">
        <div class="spec-top">${SPEC_ICONS.display}<span>DISPLAY</span></div>
        <div class="spec-val">${esc(view.display)}</div>
      </div>
    </section>

    <div class="rule" aria-hidden="true"></div>

    <section class="body">
      <div class="serial-col">
        <div class="field-label">SERIAL NUMBER</div>
        <div class="serial-num">${esc(view.serial)}</div>
        <div class="barcode-wrap">
          ${barcodeSrc
            ? `<img src="${barcodeSrc}" alt="${esc(view.barcodeValue)}" class="barcode-img" />`
            : `<div class="barcode-fallback">${esc(view.barcodeValue)}</div>`}
          <div class="barcode-caption">${esc(view.barcodeValue)}</div>
        </div>
      </div>

      <div class="qr-col">
        <div class="qr-frame">
          ${qrSrc
            ? `<img src="${qrSrc}" alt="Scan to view in ERP" class="qr-img" />`
            : `<div class="qr-fallback">QR</div>`}
        </div>
        <div class="qr-caption">SCAN TO VIEW IN ERP</div>
      </div>

      <div class="meta-col">
        <div class="meta">
          ${metaIcon('condition')}
          <div class="meta-text"><span>CONDITION</span><strong>${esc(view.condition)}</strong></div>
        </div>
        <div class="meta">
          ${metaIcon('warranty')}
          <div class="meta-text"><span>WARRANTY</span><strong>${esc(view.warranty)}</strong></div>
        </div>
        <div class="meta">
          ${metaIcon('location')}
          <div class="meta-text"><span>LOCATION</span><strong>${esc(view.location)}</strong></div>
        </div>
      </div>
    </section>
  </div>`
}

const LABEL_CSS = `
  @page { size: 100mm 60mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100mm;
    height: 60mm;
    background: #FFFFFF;
    color: ${NAVY};
    font-family: var(--font-dm-mono), ui-monospace, monospace;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { width: 100mm; height: 60mm; }
  .label {
    width: 100mm;
    height: 60mm;
    padding: 2.4mm 3mm 2.2mm;
    display: flex;
    flex-direction: column;
    background: #FFFFFF;
    overflow: hidden;
    page-break-after: always;
  }
  .label:last-child { page-break-after: auto; }

  .hdr {
    display: grid;
    grid-template-columns: auto 0.3mm minmax(0, 1fr) auto;
    gap: 2.2mm;
    align-items: center;
    min-height: 10mm;
  }
  .brand { min-width: 0; }
  .wordmark { line-height: 1; }
  .wm-deed {
    font-size: 11pt;
    font-weight: 900;
    letter-spacing: -0.6pt;
    color: ${NAVY};
    line-height: 0.95;
  }
  .wm-d { color: ${CYAN}; }
  .wm-tech {
    margin-top: 0.5mm;
    font-size: 4.2pt;
    font-weight: 800;
    letter-spacing: 1.1pt;
    color: ${CYAN};
  }
  .hdr-rule {
    width: 0.3mm;
    height: 8mm;
    background: #CBD5E1;
  }
  .title-block { min-width: 0; }
  .model {
    font-size: 9.5pt;
    font-weight: 900;
    letter-spacing: -0.15pt;
    line-height: 1.05;
    color: ${NAVY};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtitle {
    margin-top: 0.7mm;
    font-size: 5.4pt;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.55pt;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    background: ${NAVY};
    color: #FFFFFF;
    border-radius: 0.5rem;
    padding: 1.1mm 2.2mm;
    font-size: 5pt;
    font-weight: 800;
    letter-spacing: 0.45pt;
    white-space: nowrap;
  }
  .badge-spacer { width: 1mm; }

  .rule {
    height: 0.25mm;
    background: #CBD5E1;
    margin: 1.5mm 0;
  }

  .specs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    padding: 0.2mm 0;
  }
  .spec {
    padding: 0 1.6mm;
    border-right: 0.25mm solid #CBD5E1;
    min-width: 0;
  }
  .spec:first-child { padding-left: 0; }
  .spec:last-child { border-right: none; padding-right: 0; }
  .spec-top {
    display: flex;
    align-items: center;
    gap: 0.9mm;
    font-size: 4.4pt;
    font-weight: 800;
    color: ${CYAN};
    letter-spacing: 0.5pt;
  }
  .spec-top svg { flex-shrink: 0; }
  .spec-val {
    margin-top: 0.7mm;
    font-size: 6.3pt;
    font-weight: 900;
    color: ${NAVY};
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .body {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) 20mm minmax(0, 1.05fr);
    gap: 2.2mm;
    align-items: stretch;
    min-height: 0;
    padding-top: 0.2mm;
  }

  .serial-col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding-right: 1.5mm;
    border-right: 0.25mm solid #CBD5E1;
  }
  .field-label {
    font-size: 4.4pt;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.55pt;
  }
  .serial-num {
    margin-top: 0.5mm;
    font-size: 10.5pt;
    font-weight: 900;
    color: ${NAVY};
    letter-spacing: 0.1pt;
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .barcode-wrap {
    margin-top: auto;
    padding-top: 1mm;
    background: #FFFFFF;
    text-align: center;
  }
  .barcode-img {
    width: 100%;
    height: 10mm;
    object-fit: fill;
    image-rendering: crisp-edges;
  }
  .barcode-caption {
    margin-top: 0.4mm;
    font-size: 4.8pt;
    font-weight: 800;
    letter-spacing: 0.35pt;
    color: ${NAVY};
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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1mm;
    border-right: 0.25mm solid #CBD5E1;
    padding: 0 1mm;
  }
  .qr-frame {
    border: 0.35mm solid ${CYAN};
    border-radius: 0.5rem;
    padding: 1mm;
    background: #FFFFFF;
  }
  .qr-img {
    width: 15mm;
    height: 15mm;
    object-fit: contain;
    image-rendering: crisp-edges;
    display: block;
  }
  .qr-fallback {
    width: 15mm;
    height: 15mm;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 6pt;
    font-weight: 800;
    color: #64748B;
  }
  .qr-caption {
    font-size: 3.9pt;
    font-weight: 800;
    letter-spacing: 0.35pt;
    color: ${CYAN};
    text-align: center;
    line-height: 1.15;
  }

  .meta-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0;
    min-width: 0;
  }
  .meta {
    display: grid;
    grid-template-columns: 5mm minmax(0, 1fr);
    gap: 1.4mm;
    align-items: center;
    padding: 1.3mm 0;
    border-bottom: 0.25mm solid #CBD5E1;
  }
  .meta:last-child { border-bottom: none; }
  .meta-ico {
    width: 5mm;
    height: 5mm;
    border-radius: 0.5rem;
    background: ${NAVY};
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .meta-text { min-width: 0; }
  .meta-text span {
    display: block;
    font-size: 4pt;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.4pt;
  }
  .meta-text strong {
    display: block;
    margin-top: 0.3mm;
    font-size: 6pt;
    font-weight: 900;
    color: ${NAVY};
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media print {
    html, body, .sheet, .label { width: 100mm; height: 60mm; }
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
