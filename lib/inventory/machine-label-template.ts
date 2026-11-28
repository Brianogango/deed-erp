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
    <div class="ml-model">${esc(v.model)}</div>
    ${v.specs ? `<div class="ml-specs">${esc(v.specs)}</div>` : ''}
    ${v.serial ? `<div class="ml-sn">S/N: ${esc(v.serial)}</div>` : ''}
    ${v.test ? `<div class="ml-test">${esc(v.test)}</div>` : ''}
    <div class="ml-code-wrap">
      ${barcode(v.code)}
      <div class="ml-code">${esc(v.code)}</div>
    </div>
  </div>`
}

export const MACHINE_LABEL_CSS = `
  @page { size: 58mm 38mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 58mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Text keeps its size; the barcode takes what height is left (never under
     6.5 mm, which still scans), so a long name can no longer push it over the
     lines above. */
  .ml { width: 58mm; height: 38mm; padding: 1.5mm 2.6mm 1.1mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; }
  .ml:last-child { page-break-after: auto; break-after: auto; }
  .ml > * { flex: none; }
  .ml-top { display: flex; align-items: center; justify-content: space-between; gap: 1.5mm; padding-bottom: 0.9mm; border-bottom: 0.3mm solid #000; margin-bottom: 1mm; }
  .ml-cat { font-size: 7pt; font-weight: 700; letter-spacing: 0.3pt; }
  .ml-cond { font-size: 7pt; font-weight: 800; letter-spacing: 0.4pt; border: 0.3mm solid #000; padding: 0.15mm 1mm; white-space: nowrap; }
  .ml-cond-solid { background: #000; color: #fff; }
  .ml-rule { display: none; }
  .ml-model { font-size: 10pt; font-weight: 800; line-height: 1.12; max-height: 2.24em; overflow: hidden; }
  .ml-specs { font-size: 8.6pt; font-weight: 700; line-height: 1.2; margin-top: 0.5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml-sn { font-size: 7.2pt; line-height: 1.2; margin-top: 0.4mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml-test { font-size: 7.2pt; line-height: 1.2; font-weight: 700; margin-top: 0.2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml > .ml-code-wrap { flex: 1 1 auto; min-height: 9.8mm; margin-top: 1mm; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
  .ml-bar { display: block; width: 44mm; flex: 1 1 auto; min-height: 6.5mm; max-height: 10mm; object-fit: fill; }
  .ml-bar-text { font-family: monospace; font-size: 9pt; text-align: center; }
  .ml-code { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 700; letter-spacing: 0.8pt; margin-top: 0.3mm; line-height: 1; }
  .ml-internal .ml-band { background: #000; color: #fff; font-size: 7.6pt; font-weight: 800; letter-spacing: 0.4pt; text-align: center; padding: 0.9mm 0; margin: -1.5mm -2.6mm 1.4mm; }
  .ml-internal .ml-model { font-size: 11pt; }
  .ml-internal .ml-bar { max-height: 11mm; }
  .ml-foot { display: flex; align-items: baseline; justify-content: space-between; width: 100%; margin-top: 0.3mm; }
  .ml-date { font-size: 7.2pt; }
  @media print { html, body, .ml { width: 58mm; } .ml { height: 38mm; } }
`

export function printMachineLabels(views: MachineLabelView[], title = 'Machine labels'): void {
  if (!views.length) return
  openLabelPrintWindow(views.map(machineLabelHtml).join('\n'), MACHINE_LABEL_CSS, title)
}
