import type { RepairOrder } from '@/lib/store'

// All accessory names that appear on the physical card, in card order
const CARD_ACCESSORIES = [
  'Bag', 'Keyboard', 'Hard Disk', 'Processor',
  'Battery', 'Adapter', 'Memory', 'Cover', 'DVD Drive',
]

function barcodeDataUrl(value: string): string {
  if (typeof window === 'undefined') return ''
  try {
    const canvas = document.createElement('canvas')
    // JsBarcode is a CJS module — access via require-style interop
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JsBarcode = require('jsbarcode')
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: 2,
      height: 40,
      displayValue: false,
      margin: 0,
    })
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

export function printRepairSticker(job: RepairOrder): void {
  const barcodeSrc = barcodeDataUrl(job.ref)

  // Build accessories rows — checked if received
  const accessories = CARD_ACCESSORIES.map(name => {
    const match = job.accessories?.find(
      a => a.name.toLowerCase() === name.toLowerCase()
    )
    return { name, checked: match?.received ?? false }
  })

  // Split into two columns of ~5 each for the card layout
  const col1 = accessories.slice(0, 5)   // Bag … Battery
  const col2 = accessories.slice(5)      // Adapter … DVD Drive

  const checkboxRow = (items: typeof col1) =>
    items.map(a => `
      <div class="acc-row">
        <div class="acc-box">${a.checked ? '&#10003;' : ''}</div>
        <span>${a.name}</span>
      </div>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Repair Sticker — ${job.ref}</title>
<style>
  @page {
    size: 148mm 105mm;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    color: #111;
    background: #fff;
    width: 148mm;
    height: 105mm;
    overflow: hidden;
  }

  /* ── Card wrapper ── */
  .card {
    width: 148mm;
    height: 105mm;
    padding: 5mm 5mm 4mm 5mm;
    display: flex;
    flex-direction: column;
    gap: 2.5mm;
    border: 0.4mm solid #ccc;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 0.4mm solid #ddd;
    padding-bottom: 2.5mm;
    gap: 3mm;
  }
  .logo-block {
    display: flex;
    flex-direction: column;
    gap: 1mm;
  }
  .logo-text {
    font-size: 20pt;
    font-weight: 900;
    letter-spacing: -0.5pt;
    color: #00AEEF;
    line-height: 1;
  }
  .logo-text span { color: #1A1F5E; }
  .logo-sub {
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 2pt;
    color: #1A1F5E;
    text-transform: uppercase;
    margin-top: -1mm;
    margin-left: 0.5mm;
  }
  .contact-block {
    text-align: right;
    font-size: 7pt;
    line-height: 1.55;
    color: #333;
  }
  .contact-block strong { color: #111; }
  .barcode-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5mm;
  }
  .barcode-block img { height: 10mm; max-width: 28mm; }
  .barcode-ref {
    font-size: 6pt;
    font-weight: 900;
    letter-spacing: 0.5pt;
    color: #1A1F5E;
    font-family: 'Courier New', monospace;
  }

  /* ── Date + No row ── */
  .meta-row {
    display: flex;
    justify-content: space-between;
    font-size: 8.5pt;
    padding: 0 0.5mm;
  }
  .meta-row .field-inline {
    display: flex;
    align-items: flex-end;
    gap: 1.5mm;
  }
  .meta-row label { font-weight: 700; white-space: nowrap; }
  .meta-row .val {
    border-bottom: 0.3mm solid #999;
    min-width: 35mm;
    padding-bottom: 0.3mm;
    font-size: 8.5pt;
  }

  /* ── Body: left fields + right accessories ── */
  .body {
    display: flex;
    flex: 1;
    gap: 3mm;
  }
  .fields { flex: 1; display: flex; flex-direction: column; gap: 1.8mm; }
  .field-row {
    display: flex;
    align-items: flex-end;
    gap: 1.5mm;
    font-size: 8.5pt;
  }
  .field-row label { font-weight: 700; white-space: nowrap; min-width: 26mm; }
  .field-row .val {
    flex: 1;
    border-bottom: 0.3mm solid #aaa;
    padding-bottom: 0.3mm;
    font-size: 8.5pt;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 68mm;
  }
  .field-row .val.empty { color: transparent; }

  /* ── Accessories ── */
  .acc-panel {
    width: 28mm;
    flex-shrink: 0;
    border-left: 0.3mm solid #ddd;
    padding-left: 2.5mm;
    display: flex;
    gap: 2mm;
  }
  .acc-col { display: flex; flex-direction: column; gap: 1.5mm; }
  .acc-row {
    display: flex;
    align-items: center;
    gap: 1.2mm;
    font-size: 7.5pt;
    white-space: nowrap;
  }
  .acc-box {
    width: 3.5mm;
    height: 3.5mm;
    border: 0.35mm solid #555;
    border-radius: 0.5mm;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 8pt;
    line-height: 1;
    color: #111;
    flex-shrink: 0;
  }

  /* ── Signature row ── */
  .sig-row {
    display: flex;
    align-items: flex-end;
    gap: 1.5mm;
    font-size: 8.5pt;
    padding-top: 0.5mm;
    border-top: 0.3mm solid #eee;
  }
  .sig-row label { font-weight: 700; min-width: 22mm; }
  .sig-row .val {
    flex: 1;
    border-bottom: 0.3mm solid #aaa;
    height: 4mm;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="card">

  <!-- Header -->
  <div class="header">
    <div class="logo-block">
      <div class="logo-text">dee<span>d</span></div>
      <div class="logo-sub">Technologies</div>
    </div>
    <div class="barcode-block">
      ${barcodeSrc
        ? `<img src="${barcodeSrc}" alt="${job.ref}" />`
        : `<div style="font-size:7pt;color:#999;width:28mm;text-align:center;">—</div>`}
      <div class="barcode-ref">${job.ref}</div>
    </div>
    <div class="contact-block">
      Kenyatta Avenue, Sanlam House,<br/>
      1<sup>st</sup> Floor Suite 103.<br/>
      <strong>T</strong> 0113 704 451 / 0716 964 964<br/>
      <strong>E</strong> sales@deed.co.ke &nbsp;|&nbsp; <strong>W</strong> deed.africa
    </div>
  </div>

  <!-- No + Date -->
  <div class="meta-row">
    <div class="field-inline">
      <label>No:</label>
      <div class="val">${job.ref}</div>
    </div>
    <div class="field-inline">
      <label>Date:</label>
      <div class="val">${new Date(job.intakeDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
    </div>
  </div>

  <!-- Body -->
  <div class="body">
    <div class="fields">
      <div class="field-row">
        <label>Customer Name:</label>
        <div class="val">${job.customerName}</div>
      </div>
      <div class="field-row">
        <label>Phone Number:</label>
        <div class="val">${job.customerPhone || ''}</div>
      </div>
      <div class="field-row">
        <label>Serial No/Model:</label>
        <div class="val">${[job.serialNumber, job.productName].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="field-row">
        <label>Fault:</label>
        <div class="val">${job.issueDescription || ''}</div>
      </div>
    </div>

    <!-- Accessories -->
    <div class="acc-panel">
      <div class="acc-col">${checkboxRow(col1)}</div>
      <div class="acc-col">${checkboxRow(col2)}</div>
    </div>
  </div>

  <!-- Signature -->
  <div class="sig-row">
    <label>Signature:</label>
    <div class="val"></div>
  </div>

</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=600,height=450')
  if (!win) return
  win.document.write(html)
  win.document.close()
}
