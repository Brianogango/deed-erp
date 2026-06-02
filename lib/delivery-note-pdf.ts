import { Delivery, SerialNumber } from '@/lib/store'
import { getStoredCompanyData } from '@/lib/company'

const esc = (s: string | undefined | null) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const fmtDate = (d: string | undefined) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return d }
}

export interface DnPrintOptions {
  recipientName?: string
  recipientPhone?: string
  recipientIdNumber?: string
  deliveryAddress?: string
  notes?: string
}

export function generateDeliveryNoteHtml(
  delivery: Delivery,
  serials: SerialNumber[],
  options: DnPrintOptions = {},
): string {
  const co = getStoredCompanyData()

  const recipientName    = options.recipientName    || (delivery as any).recipientName    || ''
  const recipientPhone   = options.recipientPhone   || (delivery as any).recipientPhone   || ''
  const recipientIdNum   = options.recipientIdNumber || ''
  const deliveryAddress  = options.deliveryAddress  || (delivery as any).deliveryAddress  || ''
  const notes            = options.notes            || (delivery as any).notes            || ''

  // Build line rows — one sub-row per serial, or a single row for non-serialised
  const lineRows = delivery.lines.map(line => {
    if (line.serialIds && line.serialIds.length > 0) {
      return line.serialIds.map((sid, idx) => {
        const ser = serials.find(s => s.id === sid)
        const serialNo   = ser?.serial   || ser?.barcode || sid
        const specs      = ser?.specs    || ''
        return `
          <tr${idx === 0 ? '' : ' class="serial-cont"'}>
            ${idx === 0
              ? `<td rowspan="${line.serialIds.length}">${esc(line.productName)}</td>
                 <td rowspan="${line.serialIds.length}" class="c">${line.serialIds.length}</td>`
              : ''}
            <td class="mono">${esc(serialNo)}</td>
            <td>${esc(specs)}</td>
            <td class="sig-cell"></td>
          </tr>`
      }).join('')
    }
    // Non-serialised line
    return `
      <tr>
        <td>${esc(line.productName)}</td>
        <td class="c">${line.qty}</td>
        <td colspan="2" class="muted">—</td>
        <td class="sig-cell"></td>
      </tr>`
  }).join('')

  const logoBlock = co.logoUrl
    ? `<img src="${esc(co.logoUrl)}" alt="logo" style="max-height:60px;max-width:130px;object-fit:contain"/>`
    : `<span class="co-name-logo">${esc(co.name)}</span>`

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Delivery Note ${esc(delivery.ref)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;background:#fff}
.page{width:100%;max-width:780px;margin:0 auto;padding:28px 36px}
/* ── Header ── */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.co-block{text-align:right;font-size:11px;line-height:1.6}
.co-name-logo{font-size:20px;font-weight:700;color:#1B2762}
.kra{font-size:10px;color:#666;margin-bottom:2px}
.rule{border:none;border-top:2px solid #1B2762;margin:8px 0 14px}
/* ── Title + meta ── */
.title-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.dn-title{font-size:26px;font-weight:700;color:#1B2762;letter-spacing:0.5px}
.meta-block{text-align:right;font-size:11px;line-height:1.8}
.meta-label{font-weight:700;color:#555}
/* ── Parties row ── */
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:16px}
.party-box{padding:10px 14px;border:1px solid #ddd;border-radius:4px;font-size:11px;line-height:1.7}
.party-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#888;margin-bottom:4px}
.party-name{font-size:13px;font-weight:700;color:#1B2762}
/* ── Lines table ── */
.lines{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px}
.lines th{padding:7px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:#1B2762;color:#fff;border:1px solid #1B2762;text-align:left}
.lines td{padding:6px 10px;border:1px solid #ddd;vertical-align:top}
.lines tr:nth-child(even) td{background:#f9fbff}
.lines .serial-cont td{border-top:1px dashed #e0e0e0}
.c{text-align:center}
.mono{font-family:Consolas,monospace;font-size:10.5px;letter-spacing:0.3px}
.muted{color:#999;font-size:10px}
.sig-cell{min-width:60px;width:60px}
/* ── Notes ── */
.notes-box{padding:10px 14px;border:1px solid #e8e8e8;border-radius:4px;font-size:11px;line-height:1.7;margin-bottom:18px;background:#fafafa}
.notes-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#888;margin-bottom:4px}
/* ── Signature section ── */
.sig-section{border:1px solid #ccc;border-radius:4px;padding:14px 18px;margin-bottom:14px}
.sig-heading{font-size:11px;font-weight:700;color:#1B2762;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;border-bottom:1px solid #e0e0e0;padding-bottom:6px}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.sig-field{display:flex;flex-direction:column;gap:4px}
.sig-field-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#666}
.sig-line{border-bottom:1px solid #333;min-height:36px;margin-top:4px}
.sig-pre{font-size:11px;font-weight:600;color:#333;padding:4px 0}
/* ── Footer ── */
.footer{text-align:center;font-size:9px;color:#999;padding-top:10px;border-top:1px solid #e0e0e0;line-height:1.8;margin-top:10px}
.stamp-box{border:2px dashed #ccc;border-radius:6px;width:120px;height:80px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#bbb;text-align:center;margin:0 auto 8px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{padding:16px 24px}}
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="hdr">
    <div>${logoBlock}</div>
    <div class="co-block">
      <div class="kra">PIN: ${esc(co.kraPin)}</div>
      <div><strong>${esc(co.name)}</strong></div>
      <div>${esc(co.address)}</div>
      <div>${esc(co.city)}, ${esc(co.country)}</div>
      <div>${esc(co.phone)}</div>
      <div>${esc(co.email)}</div>
    </div>
  </div>
  <div class="rule"></div>

  <!-- Title + meta -->
  <div class="title-row">
    <div class="dn-title">DELIVERY NOTE</div>
    <div class="meta-block">
      <div><span class="meta-label">DN No:</span> ${esc(delivery.ref)}</div>
      <div><span class="meta-label">Date:</span> ${fmtDate(delivery.date)}</div>
      <div><span class="meta-label">Order Ref:</span> ${esc(delivery.saleOrderRef)}</div>
    </div>
  </div>

  <!-- Parties -->
  <div class="parties">
    <div class="party-box">
      <div class="party-label">Customer / Bill To</div>
      <div class="party-name">${esc(delivery.customerName)}</div>
      ${deliveryAddress ? `<div>${esc(deliveryAddress)}</div>` : ''}
    </div>
    <div class="party-box">
      <div class="party-label">Received By</div>
      <div class="party-name">${esc(recipientName) || '&nbsp;'}</div>
      ${recipientPhone ? `<div>${esc(recipientPhone)}</div>` : ''}
    </div>
  </div>

  <!-- Line items -->
  <table class="lines">
    <thead>
      <tr>
        <th style="width:38%">Product / Description</th>
        <th class="c" style="width:8%">Qty</th>
        <th style="width:22%">Serial / IMEI</th>
        <th style="width:18%">Specs</th>
        <th style="width:14%">Cond. ✓</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows}
    </tbody>
  </table>

  ${notes ? `
  <div class="notes-box">
    <div class="notes-label">Notes</div>
    <div>${esc(notes)}</div>
  </div>` : ''}

  <!-- Signature section -->
  <div class="sig-section">
    <div class="sig-heading">Receipt Acknowledgement</div>
    <div class="sig-grid">

      <div class="sig-field">
        <div class="sig-field-label">Received By (Full Name)</div>
        ${recipientName
          ? `<div class="sig-pre">${esc(recipientName)}</div>`
          : `<div class="sig-line"></div>`}
      </div>

      <div class="sig-field">
        <div class="sig-field-label">ID / Passport No.</div>
        ${recipientIdNum
          ? `<div class="sig-pre">${esc(recipientIdNum)}</div>`
          : `<div class="sig-line"></div>`}
      </div>

      <div class="sig-field">
        <div class="sig-field-label">Signature</div>
        <div class="sig-line" style="min-height:52px"></div>
      </div>

      <div class="sig-field">
        <div class="sig-field-label">Date Received</div>
        <div class="sig-line"></div>
      </div>

    </div>
  </div>

  <!-- Company stamp -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <div style="text-align:center">
      <div class="stamp-box">COMPANY<br/>STAMP</div>
      <div style="font-size:9px;color:#888">Authorised Signatory</div>
      <div class="sig-line" style="width:140px"></div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>This document confirms delivery of the goods listed above to the named recipient.</div>
    <div>Please retain a copy for your records. For queries contact ${esc(co.email)} | ${esc(co.phone)}</div>
    <div>${esc(co.name)} · ${esc(co.address)}, ${esc(co.city)} · ${esc(co.website)}</div>
  </div>

</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`

  return html
}

export function printDeliveryNote(
  delivery: Delivery,
  serials: SerialNumber[],
  options: DnPrintOptions = {},
): void {
  const html = generateDeliveryNoteHtml(delivery, serials, options)
  const win  = window.open('', '_blank', 'width=820,height=1000')
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site to print delivery notes.'); return }
  win.document.write(html)
  win.document.close()
}
