/**
 * The test bench sticker — 58 × 38 mm thermal, black only, the same size as
 * the machine sticker. PASSED / FAILED band, the key readings, a tick strip
 * of every check, the asset ID barcode, and a QR code that opens the full
 * report (staff who are signed in only: the page is behind the login).
 *
 * Browser only (QR and barcode are drawn on a canvas).
 */
import { barcodeDataUrl, esc, openLabelPrintWindow } from '@/lib/inventory/thermal-label-template'
import { summarizeTest, type UnitTest } from '@/lib/inventory/unit-tests'

/** The staff-only report a label's QR code opens. */
export function unitTestReportUrl(serialId: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  return `${origin}/inventory/unit-test/${encodeURIComponent(serialId)}`
}

async function qrDataUrl(text: string): Promise<string> {
  try {
    const QR = await import('qrcode')
    return await QR.toDataURL(text, { margin: 0, width: 160, errorCorrectionLevel: 'M' })
  } catch {
    return ''
  }
}

/** The label's text lines, without drawing (tested). */
export function unitTestLabelLines(t: UnitTest): { band: string; lines: string[]; ticks: string; note: string; foot: string } {
  const s = summarizeTest(t)
  const failed = s.headline === 'FAILED'
  const first = [s.battery, s.grade].filter(Boolean).join(' · ')
  const second = failed
    ? s.failures.filter(f => !/^Battery \d/.test(f)).slice(0, 2).join(' · ')
    : [...s.readings, t.installs.os?.trim() ? `${t.installs.os.trim()}${t.installs.osActivated ? ' ✓' : ''}` : ''].filter(Boolean).join(' · ')
  const tickList = failed
    ? s.ticks.filter(x => x.result === 'pass').map(x => x.short)
    : s.ticks.map(x => `${x.result === 'pass' ? '✓' : '✗'}${x.short}`)
  const ticks = failed ? (tickList.length ? `Passed: ${tickList.join(' ')}` : '') : tickList.join(' ')
  const note = s.overrideReason ? `Passed anyway: ${s.overrideReason}` : s.cosmetic.length ? `Note: ${s.cosmetic.join('; ')}` : ''
  return {
    band: s.headline === 'PASSED (OVERRIDE)' ? 'PASSED*' : s.headline,
    lines: [first, second].filter(Boolean),
    ticks,
    note,
    foot: s.dateTester,
  }
}

const CSS = `
  @page { size: 58mm 38mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 58mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .tl { width: 58mm; height: 38mm; padding: 0 2.2mm 1mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; }
  .tl:last-child { page-break-after: auto; break-after: auto; }
  .tl-band { display: flex; justify-content: space-between; align-items: center; margin: 0 -2.2mm 0.8mm; padding: 0.7mm 2.2mm; background: #000; color: #fff; }
  .tl-band-failed { background: #fff; color: #000; border-bottom: 0.5mm solid #000; }
  .tl-result { font-size: 9pt; font-weight: 800; letter-spacing: 0.5pt; }
  .tl-asset { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 700; }
  .tl-line { font-size: 7.6pt; font-weight: 700; line-height: 1.18; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-ticks { font-size: 6.2pt; line-height: 1.2; margin-top: 0.4mm; max-height: 2.45em; overflow: hidden; }
  .tl-note { font-size: 6.2pt; font-style: italic; line-height: 1.2; margin-top: 0.3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-bottom { margin-top: auto; display: flex; align-items: flex-end; gap: 1.6mm; }
  .tl-codes { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .tl-bar { display: block; width: 100%; height: 7mm; object-fit: fill; }
  .tl-foot { font-size: 6.4pt; margin-top: 0.3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-qr { width: 10.5mm; height: 10.5mm; flex-shrink: 0; }
  @media print { html, body, .tl { width: 58mm; } .tl { height: 38mm; } }
`

/** Print bench stickers for finished tests. */
export async function printUnitTestLabels(tests: UnitTest[]): Promise<void> {
  if (!tests.length) return
  const html = await Promise.all(tests.map(async t => {
    const v = unitTestLabelLines(t)
    const code = String(t.assetId || t.serialNumber || '').toUpperCase()
    const bar = barcodeDataUrl(code)
    const qr = await qrDataUrl(unitTestReportUrl(t.serialId))
    return `
  <div class="tl">
    <div class="tl-band ${v.band === 'FAILED' ? 'tl-band-failed' : ''}">
      <span class="tl-result">${v.band === 'FAILED' ? '✗ FAILED' : `✓ ${esc(v.band)}`}</span>
      <span class="tl-asset">${esc(code)}</span>
    </div>
    ${v.lines.map(l => `<div class="tl-line">${esc(l)}</div>`).join('')}
    ${v.ticks ? `<div class="tl-ticks">${esc(v.ticks)}</div>` : ''}
    ${v.note ? `<div class="tl-note">${esc(v.note)}</div>` : ''}
    <div class="tl-bottom">
      <div class="tl-codes">
        ${bar ? `<img class="tl-bar" src="${bar}" alt="${esc(code)}" />` : ''}
        <div class="tl-foot">${esc(v.foot)} · Test #${t.number}</div>
      </div>
      ${qr ? `<img class="tl-qr" src="${qr}" alt="Test report" />` : ''}
    </div>
  </div>`
  }))
  openLabelPrintWindow(html.join('\n'), CSS, 'Test labels')
}
