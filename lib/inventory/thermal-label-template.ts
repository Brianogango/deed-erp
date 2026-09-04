export type ThermalLabelSpec = {
  label: string
  value: string
}

export type ThermalLabelInput = {
  title: string
  barcodeValue: string
  caption?: string | null
  specs?: ThermalLabelSpec[]
}

const INK = '#000000'

function esc(value: string): string {
  return String(value ?? '')
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

export function thermalLabelHtml(input: ThermalLabelInput): string {
  const specs = (input.specs || []).filter(spec => String(spec.label || '').trim()).slice(0, 3)
  const barcodeSrc = barcodeDataUrl(input.barcodeValue)
  const caption = String(input.caption || input.barcodeValue || '').trim()

  return `
  <div class="thermal-label">
    <header class="thermal-hdr">
      <div class="thermal-brand">
        <img src="/deed-logo-receipt.png" alt="Deed Technologies" class="thermal-brand-logo" />
      </div>
      <div class="thermal-title-block">
        <div class="thermal-model">${esc(input.title)}</div>
      </div>
    </header>

    <div class="thermal-rule" aria-hidden="true"></div>

    <section class="thermal-specs" data-count="${specs.length || 1}" aria-label="Specifications">
      ${specs.length
        ? specs.map((spec, index) => `
          <div class="thermal-spec ${index === 0 ? 'thermal-spec-primary' : ''}">
            <span class="thermal-spec-key">${esc(spec.label.toUpperCase())}</span>
            <strong class="thermal-spec-val">${esc(spec.value || '—')}</strong>
          </div>`).join('')
        : `
          <div class="thermal-spec thermal-spec-primary">
            <span class="thermal-spec-key">SPECIFICATION</span>
            <strong class="thermal-spec-val">—</strong>
          </div>`}
    </section>

    <div class="thermal-rule thermal-rule-bottom" aria-hidden="true"></div>

    <section class="thermal-barcode-wrap" aria-label="Barcode">
      ${barcodeSrc
        ? `<img src="${barcodeSrc}" alt="${esc(input.barcodeValue)}" class="thermal-barcode-img" />`
        : `<div class="thermal-barcode-fallback">${esc(input.barcodeValue)}</div>`}
      <div class="thermal-barcode-caption">${esc(caption)}</div>
    </section>
  </div>`
}

export const THERMAL_LABEL_CSS = `
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

  .thermal-sheet { width: 80mm; }

  .thermal-label {
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

  .thermal-label:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  .thermal-hdr {
    display: grid;
    grid-template-columns: 13mm minmax(0, 1fr);
    gap: 1.7mm;
    align-items: center;
    min-height: 8.6mm;
  }

  .thermal-brand {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding-right: 1.5mm;
    border-right: 0.35mm solid #000;
  }

  .thermal-brand-logo {
    display: block;
    width: 11.5mm;
    max-height: 6.5mm;
    object-fit: contain;
    object-position: left center;
    filter: grayscale(1) contrast(1.8);
  }

  .thermal-title-block {
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .thermal-model {
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

  .thermal-rule {
    flex: 0 0 auto;
    height: 0.35mm;
    background: #000;
    margin: 1mm 0 1.1mm;
  }

  .thermal-specs {
    display: grid;
    gap: 1.5mm;
    align-items: stretch;
    min-height: 9.4mm;
  }

  .thermal-specs[data-count="1"] { grid-template-columns: minmax(0, 1fr); }
  .thermal-specs[data-count="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .thermal-specs[data-count="3"] {
    grid-template-columns: minmax(0, 1.65fr) minmax(0, 0.75fr) minmax(0, 1fr);
  }

  .thermal-spec {
    min-width: 0;
    padding-left: 1.5mm;
    border-left: 0.3mm solid #000;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .thermal-spec:first-child {
    border-left: none;
    padding-left: 0;
  }

  .thermal-spec-key {
    display: block;
    font-size: 5.8pt;
    font-weight: 900;
    letter-spacing: 0.35pt;
    line-height: 1;
    color: #000;
  }

  .thermal-spec-val {
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

  .thermal-specs[data-count="3"] .thermal-spec-primary .thermal-spec-val {
    font-size: 8.3pt;
  }

  .thermal-specs[data-count="1"] .thermal-spec-val {
    font-size: 9.2pt;
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .thermal-rule-bottom { margin: 1mm 0 0.8mm; }

  .thermal-barcode-wrap {
    margin-top: auto;
    width: 100%;
    min-height: 10.2mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
  }

  .thermal-barcode-img {
    display: block;
    width: 92%;
    height: 7.1mm;
    object-fit: fill;
    image-rendering: crisp-edges;
    filter: grayscale(1) contrast(2);
  }

  .thermal-barcode-caption {
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

  .thermal-barcode-fallback {
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
    html, body, .thermal-sheet, .thermal-label { width: 80mm; }
    .thermal-label { height: 40mm; }
  }
`

export function printThermalLabelBatch(items: ThermalLabelInput[], documentTitle = 'Labels'): void {
  if (!items.length || typeof window === 'undefined') return

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${esc(documentTitle)}</title>
<style>${THERMAL_LABEL_CSS}</style>
</head>
<body>
<div class="thermal-sheet">
${items.map(thermalLabelHtml).join('\n')}
</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=760,height=520')
  if (!win) return
  win.document.write(html)
  win.document.close()
}
