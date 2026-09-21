/**
 * Deed Technologies repair ticket sticker — A6 landscape (148×105mm).
 * Matches the branded repair-ticket comp: cyan/navy wordmark, field icon tiles,
 * ITEMS RECEIVED checklist panel, signature box, navy contact footer.
 */

import QRCode from 'qrcode'
import type { RepairOrder } from '@/lib/store'
import { getStoredCompanyData } from '@/lib/company'

const NAVY = '#1A1F5E'
const CYAN = '#00B0D7'
const BORDER = '#CBD5E1'

const CARD_ACCESSORIES = [
  'Bag',
  'Keyboard',
  'Hard Disk',
  'Processor',
  'Battery',
  'Adapter',
  'Memory',
  'Cover',
  'DVD Drive',
] as const

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function upper(s: string): string {
  return String(s ?? '').trim().toUpperCase()
}

async function qrDataUrl(value: string): Promise<string> {
  try {
    return await QRCode.toDataURL(value, {
      width: 140,
      margin: 1,
      color: { dark: NAVY, light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
  } catch {
    return ''
  }
}

function tileIcon(kind: 'clipboard' | 'calendar' | 'user' | 'phone' | 'laptop' | 'fault' | 'pen' | 'package'): string {
  const glyph =
    kind === 'clipboard'
      ? `<rect x="7" y="4" width="10" height="16" rx="1.5"/><path d="M9 2.5h6v3H9z"/><path d="M10 11h4M10 14h4"/>`
      : kind === 'calendar'
        ? `<rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M8 4v4M16 4v4M4 11h16"/>`
        : kind === 'user'
          ? `<circle cx="12" cy="8" r="3.5"/><path d="M5 19c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>`
          : kind === 'phone'
            ? `<rect x="8" y="3" width="8" height="18" rx="1.5"/><path d="M11 18h2"/>`
            : kind === 'laptop'
              ? `<rect x="3" y="5" width="18" height="11" rx="1.5"/><path d="M2 18h20"/>`
              : kind === 'fault'
                ? `<path d="M12 3l9 16H3L12 3z"/><path d="M12 10v4M12 17h.01"/>`
                : kind === 'pen'
                  ? `<path d="M14 4l6 6-10 10H4v-6L14 4z"/><path d="M12 6l6 6"/>`
                  : `<path d="M3 8h18v11H3z"/><path d="M3 8l2-4h14l2 4"/><path d="M12 8v11"/>`
  return `<span class="ico-tile" aria-hidden="true"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg></span>`
}

function accIcon(name: string): string {
  const key = name.toLowerCase()
  const glyph =
    key.includes('bag')
      ? `<path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8V6a3 3 0 016 0v2"/>`
      : key.includes('keyboard')
        ? `<rect x="2" y="7" width="20" height="11" rx="1.5"/><path d="M6 11h2M11 11h2M16 11h2M7 15h10"/>`
        : key.includes('hard') || key.includes('disk') || key.includes('dvd')
          ? `<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="15" cy="12" r="2"/>`
          : key.includes('processor')
            ? `<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 2v3M12 2v3M15 2v3M9 19v3M12 19v3M15 19v3M2 9h3M2 12h3M2 15h3M19 9h3M19 12h3M19 15h3"/>`
            : key.includes('battery')
              ? `<rect x="3" y="8" width="16" height="8" rx="1.5"/><path d="M19 11h2v2h-2"/>`
              : key.includes('adapter') || key.includes('charger')
                ? `<path d="M8 3v5M16 3v5M7 8h10v5a5 5 0 01-10 0V8z"/><path d="M12 18v3"/>`
                : key.includes('memory') || key.includes('ram')
                  ? `<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 17v2M11 17v2M15 17v2M19 17v2"/>`
                  : key.includes('cover')
                    ? `<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 9h16"/>`
                    : `<circle cx="12" cy="12" r="7"/>`
  return `<svg class="acc-ico" viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="${NAVY}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg>`
}

function footerIcon(kind: 'globe' | 'phone' | 'mail'): string {
  const glyph =
    kind === 'globe'
      ? `<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a14 14 0 010 16M12 4a14 14 0 000 16"/>`
      : kind === 'phone'
        ? `<path d="M8 3h4l1 4-2 1a10 10 0 005 5l1-2 4 1v4a2 2 0 01-2 2A15 15 0 013 5a2 2 0 012-2z"/>`
        : `<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 8l9 6 9-6"/>`
  return `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="${CYAN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg>`
}

function formatPhoneDisplay(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  if (digits.length === 9) return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  return String(raw || '').trim()
}

function websiteHost(url: string): string {
  return String(url || 'deed.africa')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
}

function readAppFontVars(): { ui: string; mono: string; faces: string } {
  if (typeof document === 'undefined') {
    return { ui: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', faces: '' }
  }
  const root = getComputedStyle(document.documentElement)
  const openSans = root.getPropertyValue('--font-open-sans').trim()
  const roboto = root.getPropertyValue('--font-roboto-flex').trim()
  const inter = root.getPropertyValue('--font-inter').trim()
  const dm = root.getPropertyValue('--font-dm-mono').trim()
  const uiStack = [openSans, roboto, inter, 'system-ui', 'sans-serif'].filter(Boolean).join(', ')
  const monoStack = [dm, 'ui-monospace', 'monospace'].filter(Boolean).join(', ')

  // Copy @font-face rules from the opener so print preview keeps brand faces.
  const faces: string[] = []
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) faces.push(rule.cssText)
      }
    }
  } catch {
    /* cross-origin sheets ignored */
  }
  return { ui: uiStack, mono: monoStack, faces: faces.join('\n') }
}

export async function printRepairSticker(job: RepairOrder): Promise<void> {
  const company = getStoredCompanyData()
  const portalUrl = `https://erp.deed.co.ke/portal/repair/${encodeURIComponent(job.ref)}`
  const qrSrc = await qrDataUrl(portalUrl)
  const fonts = readAppFontVars()

  const accessories = CARD_ACCESSORIES.map(name => {
    const match = job.accessories?.find(a => a.name.toLowerCase() === name.toLowerCase())
    return { name, checked: match?.received ?? false }
  })
  const col1 = accessories.slice(0, 5)
  const col2 = accessories.slice(5)

  const date = (() => {
    const d = new Date(job.intakeDate)
    if (Number.isNaN(d.getTime())) return String(job.intakeDate || '')
    const raw = String(job.intakeDate || '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return d.toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' })
    }
    return d.toLocaleString('en-GB', {
      timeZone: 'Africa/Nairobi',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  })()

  const serialModel = [job.productName, job.serialNumber].filter(Boolean).join(' / ')
  const companyPhone = formatPhoneDisplay(company.phone)
  const phoneLine = [companyPhone, '0716 964 964'].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' / ')
  const email = /sales@/i.test(company.email || '')
    ? company.email
    : 'sales@deed.co.ke'
  const site = websiteHost(company.website || 'deed.africa')

  const checkboxCol = (items: typeof col1) =>
    items
      .map(
        a => `
      <div class="acc-row">
        <span class="acc-box${a.checked ? ' is-on' : ''}">${a.checked ? '✓' : ''}</span>
        ${accIcon(a.name)}
        <span class="acc-name">${esc(a.name)}</span>
      </div>`,
      )
      .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Repair Ticket - ${esc(job.ref)}</title>
<style>
  ${fonts.faces}
  @page { size: 148mm 105mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${fonts.ui};
    color: ${NAVY};
    background: #fff;
    width: 148mm;
    height: 105mm;
    overflow: hidden;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .card {
    width: 148mm;
    height: 105mm;
    padding: 4mm 4.5mm 0;
    display: flex;
    flex-direction: column;
    border: 0.35mm solid ${BORDER};
    border-radius: 0.75rem;
    overflow: hidden;
    background: #fff;
  }
  .header {
    display: grid;
    grid-template-columns: 34mm 1fr 34mm;
    align-items: center;
    gap: 2mm;
    padding-bottom: 2.2mm;
    border-bottom: 0.45mm solid ${NAVY};
  }
  .wordmark { line-height: 1; }
  .wm-deed {
    font-size: 18pt;
    font-weight: 900;
    letter-spacing: -0.6pt;
    color: ${NAVY};
    line-height: 0.95;
  }
  .wm-d { color: ${CYAN}; }
  .wm-tech {
    font-size: 5.5pt;
    font-weight: 800;
    letter-spacing: 0.22em;
    color: ${CYAN};
    text-transform: uppercase;
    margin-top: 0.6mm;
  }
  .title-block { text-align: center; }
  .title {
    font-size: 16pt;
    font-weight: 900;
    letter-spacing: 0.04em;
    color: ${NAVY};
    line-height: 1;
    text-transform: uppercase;
  }
  .tagline {
    margin-top: 1.2mm;
    font-size: 6.5pt;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: ${NAVY};
    text-transform: uppercase;
  }
  .tag-dot { color: ${CYAN}; margin: 0 1.2mm; }
  .qr-block {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1.6mm;
  }
  .qr-block img {
    width: 15mm;
    height: 15mm;
    display: block;
  }
  .qr-fallback {
    width: 15mm;
    height: 15mm;
    border: 0.3mm solid ${BORDER};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 5.5pt;
    color: #64748B;
    text-align: center;
    padding: 1mm;
  }
  .qr-side {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.8mm;
    max-width: 16mm;
  }
  .qr-side svg { display: block; }
  .qr-caption {
    font-size: 5.2pt;
    font-weight: 800;
    line-height: 1.15;
    color: ${CYAN};
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .body {
    flex: 1;
    display: grid;
    grid-template-columns: 1.35fr 1fr;
    gap: 3mm;
    padding: 2.5mm 0 2mm;
    min-height: 0;
  }
  .fields {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 1.8mm;
    padding: 1.7mm 0;
    border-bottom: 0.25mm solid ${BORDER};
    min-width: 0;
  }
  .field-row:last-child { border-bottom: 0; }
  .ico-tile {
    width: 5.2mm;
    height: 5.2mm;
    border-radius: 0.5rem;
    background: ${NAVY};
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .field-split {
    display: flex;
    align-items: center;
    gap: 2.5mm;
    flex: 1;
    min-width: 0;
  }
  .field-part {
    display: flex;
    align-items: baseline;
    gap: 1.2mm;
    min-width: 0;
  }
  .field-part.grow { flex: 1; }
  .lbl {
    font-size: 7.2pt;
    font-weight: 700;
    color: ${NAVY};
    white-space: nowrap;
  }
  .val {
    font-family: ${fonts.mono};
    font-size: 8pt;
    font-weight: 700;
    color: ${NAVY};
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .acc-panel {
    border: 0.35mm solid ${BORDER};
    border-radius: 0.5rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #fff;
  }
  .acc-head {
    background: ${NAVY};
    color: #fff;
    display: flex;
    align-items: center;
    gap: 1.5mm;
    padding: 1.6mm 2.2mm;
    font-size: 7.5pt;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .acc-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 2mm;
    padding: 1.5mm 2mm 1.8mm;
    flex: 1;
  }
  .acc-col { display: flex; flex-direction: column; }
  .acc-row {
    display: flex;
    align-items: center;
    gap: 1.2mm;
    padding: 1.35mm 0;
    border-bottom: 0.25mm dotted ${BORDER};
    font-size: 6.8pt;
    font-weight: 700;
    color: ${NAVY};
    white-space: nowrap;
  }
  .acc-col .acc-row:last-child { border-bottom: 0; }
  .acc-box {
    width: 3.2mm;
    height: 3.2mm;
    border: 0.35mm solid ${NAVY};
    border-radius: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 6pt;
    line-height: 1;
    flex-shrink: 0;
    color: ${NAVY};
  }
  .acc-box.is-on { background: color-mix(in srgb, ${CYAN} 18%, #fff); }
  .acc-ico { flex-shrink: 0; }
  .acc-name { overflow: hidden; text-overflow: ellipsis; }
  .sig {
    margin: 0 0 2.2mm;
    border: 0.4mm solid ${NAVY};
    border-radius: 0.5rem;
    padding: 2.2mm 2.5mm;
    display: flex;
    align-items: center;
    gap: 2mm;
  }
  .sig-label {
    font-size: 8pt;
    font-weight: 800;
    color: ${NAVY};
    white-space: nowrap;
  }
  .sig-line {
    flex: 1;
    border-bottom: 0.35mm dotted ${NAVY};
    height: 4.5mm;
    min-width: 20mm;
  }
  .footer {
    margin: 0 -4.5mm;
    background: ${NAVY};
    color: #fff;
    display: grid;
    grid-template-columns: 1fr 1.35fr 1.15fr;
    align-items: center;
    min-height: 8.5mm;
    padding: 0 3mm;
  }
  .foot-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.4mm;
    font-size: 6.6pt;
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 1.8mm 1mm;
    white-space: nowrap;
  }
  .foot-cell + .foot-cell {
    border-left: 0.25mm solid rgba(255,255,255,0.35);
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .card { border: none; border-radius: 0; }
  }
</style>
</head>
<body>
  <div class="card">
    <header class="header">
      <div class="wordmark">
        <div class="wm-deed"><span class="wm-d">d</span>eed</div>
        <div class="wm-tech">TECHNOLOGIES</div>
      </div>
      <div class="title-block">
        <div class="title">REPAIR TICKET</div>
        <div class="tagline">SERVICE<span class="tag-dot">•</span>DIAGNOSE<span class="tag-dot">•</span>FIX</div>
      </div>
      <div class="qr-block">
        ${
          qrSrc
            ? `<img src="${qrSrc}" alt="QR ${esc(job.ref)}" />`
            : `<div class="qr-fallback">${esc(job.ref)}</div>`
        }
        <div class="qr-side">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${CYAN}" stroke-width="1.9" aria-hidden="true">
            <rect x="7" y="2" width="10" height="20" rx="2"/>
            <path d="M11 18h2"/>
          </svg>
          <div class="qr-caption">Scan to track repair.</div>
        </div>
      </div>
    </header>

    <div class="body">
      <div class="fields">
        <div class="field-row">
          ${tileIcon('clipboard')}
          <div class="field-split">
            <div class="field-part grow">
              <span class="lbl">No:</span>
              <span class="val">${esc(upper(job.ref))}</span>
            </div>
            <div class="field-part">
              ${tileIcon('calendar')}
              <span class="lbl">Date:</span>
              <span class="val">${esc(date)}</span>
            </div>
          </div>
        </div>
        <div class="field-row">
          ${tileIcon('user')}
          <span class="lbl">Customer Name:</span>
          <span class="val">${esc(upper(job.customerName || ''))}</span>
        </div>
        <div class="field-row">
          ${tileIcon('phone')}
          <span class="lbl">Phone Number:</span>
          <span class="val">${esc(job.customerPhone || job.contactPersonPhone || '')}</span>
        </div>
        <div class="field-row">
          ${tileIcon('laptop')}
          <span class="lbl">Serial No/Model:</span>
          <span class="val">${esc(upper(serialModel))}</span>
        </div>
        <div class="field-row">
          ${tileIcon('fault')}
          <span class="lbl">Fault:</span>
          <span class="val">${esc(upper(job.issueDescription || ''))}</span>
        </div>
      </div>

      <aside class="acc-panel">
        <div class="acc-head">
          ${tileIcon('package')}
          <span>ITEMS RECEIVED</span>
        </div>
        <div class="acc-body">
          <div class="acc-col">${checkboxCol(col1)}</div>
          <div class="acc-col">${checkboxCol(col2)}</div>
        </div>
      </aside>
    </div>

    <div class="sig">
      ${tileIcon('pen')}
      <span class="sig-label">Signature:</span>
      <div class="sig-line"></div>
    </div>

    <footer class="footer">
      <div class="foot-cell">${footerIcon('globe')}<span>${esc(site)}</span></div>
      <div class="foot-cell">${footerIcon('phone')}<span>${esc(phoneLine)}</span></div>
      <div class="foot-cell">${footerIcon('mail')}<span>${esc(email)}</span></div>
    </footer>
  </div>
  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=700,height=520')
  if (!win) return
  win.document.write(html)
  win.document.close()
}
