import type { Product } from '@/lib/store'
import QRCode from 'qrcode'
import { buildSerialLabelScanPayload } from '@/lib/barcode-scan'

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

// Single label HTML block
function labelHtml(product: Product, barcodeSrc: string): string {
  const barcodeValue = product.barcode || product.sku
  return `
  <div class="label">
    <div class="label-top">
      <div class="brand">deed<span>.</span></div>
      <div class="cat">${esc(product.category)}</div>
    </div>
    <div class="name">${esc(product.name)}</div>
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

// Per-unit serial label — QR + CODE128 encode the inventory barcode (POS-ready).
function serialLabelHtml(
  item: { serial: string; barcode?: string; productName: string; sku: string; salePrice?: number; category?: string },
  qrSrc: string,
  barcodeSrc: string,
  scanPayload: string,
): string {
  return `
  <div class="label serial-label">
    <div class="label-main">
      <div class="copy">
        <div class="label-top">
          <div class="brand">deed<span>.</span></div>
          <div class="cat">${esc(item.category || 'UNIT')}</div>
        </div>
        <div class="name">${esc(item.productName)}</div>
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

export async function printSerialLabels(items: Array<{
  serial: string; barcode?: string; productName: string; sku: string; salePrice?: number; category?: string
}>): Promise<void> {
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
<style>
  @page { size: A4; margin: 8mm 8mm 8mm 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #0F172A; }
  .sheet {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4mm;
  }
  .label {
    border: 0.35mm solid #CBD5E1;
    border-radius: 2mm;
    padding: 2.4mm;
    height: 44mm;
    overflow: hidden;
    page-break-inside: avoid;
    background: #fff;
  }
  .serial-label { border-left: 1.2mm solid #1A1F5E; }
  .label-main { display: grid; grid-template-columns: minmax(0, 1fr) 18mm; gap: 2mm; height: 100%; align-items: stretch; }
  .copy { min-width: 0; display: flex; flex-direction: column; gap: 0.9mm; }
  .label-top { display: flex; justify-content: space-between; align-items: center; gap: 1mm; }
  .brand { font-size: 8.5pt; font-weight: 900; color: #00AEEF; letter-spacing: -0.3pt; }
  .brand span { color: #1A1F5E; }
  .cat { font-size: 5.5pt; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.45pt; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 23mm; }
  .name { font-size: 7pt; font-weight: 800; color: #0F172A; line-height: 1.16; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .serial-block { margin-top: 0.4mm; }
  .eyebrow { font-size: 4.8pt; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.5pt; }
  .serial-num { font-size: 9.5pt; font-weight: 900; font-family: 'Courier New', monospace; color: #1A1F5E; letter-spacing: 0.15pt; line-height: 1.05; }
  .sku-pill { display: inline-flex; align-items: center; gap: 1.2mm; max-width: 100%; border: 0.25mm solid #CBD5E1; border-radius: 999px; padding: 0.6mm 1.3mm; font-size: 6pt; font-weight: 800; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sku-pill span { color: #64748B; font-size: 5pt; letter-spacing: 0.45pt; }
  .barcode-wrap { margin-top: auto; display: flex; flex-direction: column; align-items: stretch; gap: 0.4mm; }
  .barcode-img { width: 100%; height: 8mm; object-fit: fill; image-rendering: crisp-edges; }
  .barcode-num { font-size: 5.5pt; font-weight: 800; font-family: 'Courier New', monospace; color: #334155; letter-spacing: 0.2pt; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qr-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.8mm; border-left: 0.25mm solid #E2E8F0; padding-left: 1.5mm; }
  .qr-img { width: 17mm; height: 17mm; object-fit: contain; image-rendering: crisp-edges; }
  .qr-placeholder { width: 17mm; height: 17mm; border: 0.3mm dashed #CBD5E1; border-radius: 1mm; }
  .qr-caption { font-size: 4.8pt; font-weight: 900; color: #64748B; letter-spacing: 0.55pt; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
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

export function printProductLabels(product: Product, qty: number): void {
  const barcodeValue = product.barcode || product.sku
  const barcodeSrc = barcodeDataUrl(barcodeValue)

  // Build qty copies of the label
  const labels = Array.from({ length: qty }, () => labelHtml(product, barcodeSrc)).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Product Label — ${esc(product.name)}</title>
<style>
  @page { size: A4; margin: 8mm 8mm 8mm 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #fff;
    color: #111;
  }

  /* 3-column label grid on A4 */
  .sheet {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4mm;
  }

  .label {
    border: 0.4mm solid #ccc;
    border-radius: 1.5mm;
    padding: 2.5mm 3mm;
    display: flex;
    flex-direction: column;
    gap: 1.2mm;
    height: 40mm;
    overflow: hidden;
    page-break-inside: avoid;
  }

  .label-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .brand {
    font-size: 8pt;
    font-weight: 900;
    color: #00AEEF;
    letter-spacing: -0.3pt;
  }
  .brand span { color: #1A1F5E; }
  .cat {
    font-size: 6pt;
    font-weight: 700;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    text-align: right;
  }

  .name {
    font-size: 8.5pt;
    font-weight: 800;
    color: #111;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .price {
    font-size: 11pt;
    font-weight: 900;
    color: #1A1F5E;
    margin-top: 0.5mm;
  }

  .barcode-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: auto;
    gap: 0.5mm;
  }
  .barcode-img {
    width: 100%;
    height: 9mm;
    object-fit: contain;
    object-position: center;
  }
  .barcode-placeholder {
    width: 100%;
    height: 9mm;
    border: 0.3mm dashed #ddd;
    border-radius: 0.5mm;
  }
  .barcode-num {
    font-size: 6pt;
    font-family: 'Courier New', monospace;
    color: #444;
    letter-spacing: 0.5pt;
  }

  .sku {
    font-size: 6pt;
    color: #999;
    text-align: center;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
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
