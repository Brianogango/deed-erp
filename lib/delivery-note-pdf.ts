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
body{font-family:Inter,Arial,Helvetica,sans-serif;font-size:11px;color:#0F172A;background:#F3F6FB}
.page{width:100%;max-width:820px;margin:0 auto 24px;background:#fff;min-height:1120px;box-shadow:0 28px 80px rgba(15,23,42,.12);position:relative;overflow:hidden}
.page:before{content:"";position:absolute;inset:0 0 auto;height:7px;background:linear-gradient(90deg,#1B2762,#00AEEF,#10B981)}
/* ── Header ── */
.hdr{display:grid;grid-template-columns:1fr 1.35fr;gap:28px;align-items:start;padding:36px 42px 26px;background:linear-gradient(135deg,#F8FAFC 0%,#EEF6FF 100%);border-bottom:1px solid #DDE7F3}
.co-block{text-align:right;font-size:10.5px;line-height:1.58;color:#475569}
.co-name-logo{display:inline-flex;align-items:center;justify-content:center;min-width:118px;min-height:58px;border-radius:18px;background:#1B2762;color:#fff;font-size:19px;font-weight:950;letter-spacing:-.02em;padding:12px 16px}
.kra{font-size:10px;color:#1B2762;font-weight:800;margin-bottom:2px}
.rule{display:none}
/* ── Title + meta ── */
.title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:28px 42px 18px}
.dn-title{font-size:30px;font-weight:950;color:#0F172A;letter-spacing:-.045em;line-height:1}
.meta-block{text-align:right;font-size:11px;line-height:1.8;border:1px solid #E2E8F0;border-radius:16px;background:#fff;padding:12px 14px;min-width:210px}
.meta-label{font-weight:900;color:#64748B;text-transform:uppercase;font-size:9px;letter-spacing:.08em}
/* ── Parties row ── */
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 42px 20px}
.party-box{padding:14px 16px;border:1px solid #E2E8F0;border-radius:16px;font-size:11px;line-height:1.7;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.party-label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.09em;color:#64748B;margin-bottom:5px}
.party-name{font-size:14px;font-weight:950;color:#0F172A}
/* ── Lines table ── */
.lines{width:calc(100% - 84px);margin:0 42px 18px;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid #E2E8F0;border-radius:16px;font-size:11px}
.lines th{padding:11px 12px;font-size:9px;font-weight:950;text-transform:uppercase;letter-spacing:.09em;background:#10204A;color:#fff;text-align:left}
.lines td{padding:10px 12px;border-bottom:1px solid #E2E8F0;vertical-align:top}
.lines tr:nth-child(even) td{background:#F8FAFC}
.lines tbody tr:last-child td{border-bottom:0}
.lines .serial-cont td{border-top:1px dashed #CBD5E1}
.c{text-align:center}
.mono{font-family:Consolas,monospace;font-size:10.5px;letter-spacing:0.3px}
.muted{color:#64748B;font-size:10px}
.sig-cell{min-width:60px;width:60px}
/* ── Notes ── */
.notes-box{padding:14px 16px;border:1px solid #E2E8F0;border-radius:16px;font-size:11px;line-height:1.7;margin:0 42px 20px;background:#F8FAFC}
.notes-label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.09em;color:#64748B;margin-bottom:5px}
/* ── Signature section ── */
.sig-section{border:1px solid #E2E8F0;border-radius:16px;padding:16px 18px;margin:0 42px 18px}
.sig-heading{font-size:11px;font-weight:950;color:#1B2762;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;border-bottom:1px solid #E2E8F0;padding-bottom:8px}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.sig-field{display:flex;flex-direction:column;gap:4px}
.sig-field-label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#64748B}
.sig-line{border-bottom:1px solid #334155;min-height:36px;margin-top:4px}
.sig-pre{font-size:11px;font-weight:600;color:#333;padding:4px 0}
/* ── Footer ── */
.footer{text-align:center;font-size:9px;color:#64748B;padding:14px 0 24px;border-top:1px solid #E2E8F0;line-height:1.8;margin:0 42px}
.stamp-box{border:2px dashed #CBD5E1;border-radius:12px;width:128px;height:82px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#94A3B8;text-align:center;margin:0 auto 8px;background:#F8FAFC}
@media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{box-shadow:none;margin:0;max-width:none;min-height:auto}}
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
