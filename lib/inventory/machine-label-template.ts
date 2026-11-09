/**
 * The machine sticker — 58 × 38 mm thermal label, Code 128 (asset ID).
 * Content comes from lib/inventory/machine-label.ts; barcode drawing and the
 * print window are the shared ones in thermal-label-template.ts.
 *
 * Black only, so the versions differ by shape: REFURBISHED in an outlined
 * box, BRAND NEW in a solid box, With Issues with a solid band across the top.
 */
import { barcodeDataUrl, esc, openLabelPrintWindow } from '@/lib/inventory/thermal-label-template'
import type { MachineLabelView } from '@/lib/inventory/machine-label'

function barcode(code: string): string {
  const src = barcodeDataUrl(code)
  return src
    ? `<img class="ml-bar" src="${src}" alt="${esc(code)}" />`
    : `<div class="ml-bar ml-bar-text">${esc(code)}</div>`
}

export function machineLabelHtml(v: MachineLabelView): string {
  if (v.variant === 'with_issues') {
    return `
  <div class="ml ml-internal">
    <div class="ml-band">${esc(v.condition)}</div>
    <div class="ml-model">${esc(v.model)}</div>
    <div class="ml-code-wrap">
      ${barcode(v.code)}
      <div class="ml-foot"><span class="ml-code">${esc(v.code)}</span>${v.dateIn ? `<span class="ml-date">In ${esc(v.dateIn)}</span>` : ''}</div>
    </div>
  </div>`
  }
  return `
  <div class="ml">
    <div class="ml-top">
      <span class="ml-cat">${esc(v.category)}</span>
      <span class="ml-cond ${v.variant === 'new' ? 'ml-cond-solid' : ''}">${esc(v.condition)}</span>
    </div>
    <div class="ml-rule"></div>
    <div class="ml-model">${esc(v.model)}</div>
    ${v.specs ? `<div class="ml-specs">${esc(v.specs)}</div>` : ''}
    ${v.serial ? `<div class="ml-sn">S/N: ${esc(v.serial)}</div>` : ''}
    <div class="ml-code-wrap">
      ${barcode(v.code)}
      <div class="ml-code">${esc(v.code)}</div>
    </div>
  </div>`
}

const CSS = `
  @page { size: 58mm 38mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 58mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ml { width: 58mm; height: 38mm; padding: 1.6mm 2.4mm 1.2mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; }
  .ml:last-child { page-break-after: auto; break-after: auto; }
  .ml-top { display: flex; align-items: center; justify-content: space-between; gap: 1.5mm; }
  .ml-cat { font-size: 7.4pt; font-weight: 700; letter-spacing: 0.2pt; }
  .ml-cond { font-size: 7.6pt; font-weight: 800; letter-spacing: 0.3pt; border: 0.35mm solid #000; padding: 0.2mm 1.1mm; white-space: nowrap; }
  .ml-cond-solid { background: #000; color: #fff; }
  .ml-rule { border-top: 0.3mm solid #000; margin: 0.8mm 0 1mm; }
  .ml-model { font-size: 10.2pt; font-weight: 800; line-height: 1.12; max-height: 2.3em; overflow: hidden; }
  .ml-specs { font-size: 9pt; font-weight: 700; line-height: 1.15; margin-top: 0.3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml-sn { font-size: 7.6pt; margin-top: 0.5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml-code-wrap { margin-top: auto; display: flex; flex-direction: column; align-items: center; }
  .ml-bar { display: block; width: 40mm; height: 9.5mm; object-fit: fill; }
  .ml-bar-text { font-family: monospace; font-size: 9pt; text-align: center; }
  .ml-code { font-family: 'Courier New', monospace; font-size: 8.4pt; font-weight: 700; letter-spacing: 0.6pt; margin-top: 0.4mm; }
  .ml-internal .ml-band { background: #000; color: #fff; font-size: 7.6pt; font-weight: 800; letter-spacing: 0.4pt; text-align: center; padding: 0.9mm 0; margin: -1.6mm -2.4mm 1.4mm; }
  .ml-internal .ml-model { font-size: 11pt; }
  .ml-internal .ml-bar { height: 11mm; }
  .ml-foot { display: flex; align-items: baseline; justify-content: space-between; width: 100%; margin-top: 0.4mm; }
  .ml-date { font-size: 7.2pt; }
  @media print { html, body, .ml { width: 58mm; } .ml { height: 38mm; } }
`

export function printMachineLabels(views: MachineLabelView[], title = 'Machine labels'): void {
  if (!views.length) return
  openLabelPrintWindow(views.map(machineLabelHtml).join('\n'), CSS, title)
}
