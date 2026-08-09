import type { Product } from '@/lib/store'
import QRCode from 'qrcode'
import { buildSerialLabelScanPayload } from '@/lib/barcode-scan'
import {
  categoryConditionLine,
  resolveProductSpecs,
  truncateLabelText,
  type SerialLabelItem,
} from '@/lib/product-label-meta'

export type { SerialLabelItem, ProductLabelCondition } from '@/lib/product-label-meta'
export { formatConditionLabel, categoryConditionLine } from '@/lib/product-label-meta'

// Generate a CODE128 barcode as a data URL using JsBarcode
function barcodeDataUrl(value: string): string {
  if (typeof window === 'undefined' || !value.trim()) return ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JsBarcode = require('jsbarcode')
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: 1.8,
      height: 36,
      displayValue: false,
      margin: 0,
    })
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function qrDataUrl(value: string): Promise<string> {
  if (typeof window === 'undefined' || !value.trim()) return ''
  try {
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 144,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
  } catch {
    return ''
  }
}

function formatPrice(n: number): string {
  return 'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function labelHtml(product: Product, barcodeSrc: string): string {
  const barcodeValue = product.barcode || product.sku
  const meta = categoryConditionLine(product.category, (product as any).productType)
  const specs = truncateLabelText(resolveProductSpecs(product as any), 72)
  return `
  <div class="label">
    <div class="label-top">
      <div class="brand">deed<span>.</span></div>
      <div class="cat">${esc(meta || 'PRODUCT')}</div>
    </div>
    <div class="name">${esc(product.name)}</div>
    ${specs ? `<div class="specs">${esc(specs)}</div>` : ''}
    <div class="price">${formatPrice(product.salePrice)}</div>
    <div class="barcode-wrap">
      ${barcodeSrc
        ? `<img src="${barcodeSrc}" alt="${esc(barcodeValue)}" class="barcode-img" />`
        : `<div class="barcode-placeholder"></div>`}
      <div class="barcode-num">${esc(barcodeValue)}</div>
    </div>
    <div class="sku">SKU: ${esc(product.sku)}</div>
  </div>`
}

function serialLabelHtml(
  item: SerialLabelItem,
  qrSrc: string,
  barcodeSrc: string,
  scanPayload: string,
): string {
  const invBarcode = String(item.barcode ?? '').trim()
  const showInvHint = invBarcode && invBarcode.toUpperCase() !== scanPayload.toUpperCase()
  const meta = categoryConditionLine(item.category, item.productType)
  const specs = truncateLabelText(item.specs || '', 64)
  return `
  <div class="label serial-label">
    <div class="label-main">
      <div class="copy">
        <div class="label-top">
          <div class="brand">deed<span>.</span></div>
          <div class="cat">${esc(meta || 'UNIT')}</div>
        </div>
        <div class="name">${esc(item.productName)}</div>
        ${specs ? `<div class="specs">${esc(specs)}</div>` : ''}
        <div class="serial-block">
          <div class="eyebrow">Serial No.</div>
          <div class="serial-num">${esc(item.serial)}</div>
        </div>
        ${item.sku ? `<div class="sku-pill"><span>SKU</span>${esc(item.sku)}</div>` : ''}
        <div class="barcode-wrap">
          ${barcodeSrc
            ? `<img src="${barcodeSrc}" alt="${esc(scanPayload)}" class="barcode-img" />`
            : ''}
          <div class="barcode-num">${esc(scanPayload)}</div>
          ${showInvHint ? `<div class="inv-hint">INV ${esc(invBarcode)}</div>` : ''}
        </div>
      </div>
      <div class="qr-wrap">
        ${qrSrc
          ? `<img src="${qrSrc}" alt="${esc(scanPayload)}" class="qr-img" />`
          : `<div class="qr-placeholder"></div>`}
        <div class="qr-caption">SCAN</div>
      </div>
    </div>
  </div>`
}

const LABEL_PRINT_CSS = `
  @page { size: A4; margin: 8mm 8mm 8mm 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-dm-mono), ui-monospace, monospace;
    background: #FFFFFF;
    color: #0F172A;
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4mm;
  }
  .label {
    border: 0.35mm solid #CBD5E1;
    border-radius: 0.5rem;
    padding: 2.2mm;
    height: 48mm;
    overflow: hidden;
    page-break-inside: avoid;
    background: #FFFFFF;
  }
  .serial-label { border-left: 1.2mm solid #1A1F5E; }
  .label-main { display: grid; grid-template-columns: minmax(0, 1fr) 18mm; gap: 2mm; height: 100%; align-items: stretch; }
  .copy { min-width: 0; display: flex; flex-direction: column; gap: 0.7mm; }
  .label-top { display: flex; justify-content: space-between; align-items: center; gap: 1mm; }
  .brand { font-size: 8.5pt; font-weight: 900; color: #00B0D7; letter-spacing: -0.3pt; }
  .brand span { color: #1A1F5E; }
  .cat { font-size: 5.2pt; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.35pt; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 28mm; }
  .name { font-size: 6.8pt; font-weight: 800; color: #0F172A; line-height: 1.14; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .specs { font-size: 5.2pt; font-weight: 700; color: #475569; line-height: 1.15; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .serial-block { margin-top: 0.2mm; }
  .eyebrow { font-size: 4.6pt; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.5pt; }
  .serial-num { font-size: 9pt; font-weight: 900; color: #1A1F5E; letter-spacing: 0.15pt; line-height: 1.05; }
  .sku-pill { display: inline-flex; align-items: center; gap: 1.2mm; max-width: 100%; border: 0.25mm solid #CBD5E1; border-radius: 0.5rem; padding: 0.5mm 1.2mm; font-size: 5.8pt; font-weight: 800; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sku-pill span { color: #64748B; font-size: 4.8pt; letter-spacing: 0.45pt; }
  .barcode-wrap { margin-top: auto; display: flex; flex-direction: column; align-items: stretch; gap: 0.3mm; }
  .barcode-img { width: 100%; height: 7.5mm; object-fit: fill; image-rendering: crisp-edges; }
  .barcode-num { font-size: 5.2pt; font-weight: 800; color: #1E293B; letter-spacing: 0.2pt; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .inv-hint { font-size: 4.3pt; font-weight: 700; color: #64748B; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qr-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.8mm; border-left: 0.25mm solid #CBD5E1; padding-left: 1.5mm; }
  .qr-img { width: 17mm; height: 17mm; object-fit: contain; image-rendering: crisp-edges; }
  .qr-placeholder { width: 17mm; height: 17mm; border: 0.3mm dashed #CBD5E1; border-radius: 0.5rem; }
  .qr-caption { font-size: 4.8pt; font-weight: 900; color: #64748B; letter-spacing: 0.55pt; }
  .price { font-size: 10.5pt; font-weight: 900; color: #1A1F5E; margin-top: 0.3mm; }
  .barcode-placeholder { width: 100%; height: 8.5mm; border: 0.3mm dashed #CBD5E1; border-radius: 0.5rem; }
  .sku { font-size: 6pt; color: #64748B; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`

export async function printSerialLabels(items: SerialLabelItem[]): Promise<void> {
  if (!items.length) return

  const labels = (await Promise.all(items.map(async item => {
    const scanPayload = buildSerialLabelScanPayload(item)
    const qrSrc = await qrDataUrl(scanPayload)
    const barcodeSrc = barcodeDataUrl(scanPayload)
    return serialLabelHtml(item, qrSrc, barcodeSrc, scanPayload)
  }))).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Serial Labels</title>
<style>${LABEL_PRINT_CSS}</style>
</head>
<body>
<div class="sheet">
${labels}
</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=700,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

export function printProductLabels(product: Product, qty: number): void {
  const barcodeValue = product.barcode || product.sku
  const barcodeSrc = barcodeDataUrl(barcodeValue)
  const labels = Array.from({ length: qty }, () => labelHtml(product, barcodeSrc)).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Product Label — ${esc(product.name)}</title>
<style>
${LABEL_PRINT_CSS}
  .label { height: 44mm; padding: 2.5mm 3mm; gap: 1mm; display: flex; flex-direction: column; }
  .name { font-size: 8pt; line-height: 1.2; }
  .specs { font-size: 5.5pt; }
  .barcode-img { height: 8.5mm; object-fit: contain; object-position: center; }
  .barcode-num { font-size: 6pt; letter-spacing: 0.5pt; color: #475569; }
</style>
</head>
<body>
<div class="sheet">
${labels}
</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=700,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
}
