import type { Product } from '@/lib/store'

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
