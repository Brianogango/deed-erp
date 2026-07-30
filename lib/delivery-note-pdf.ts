import { Delivery, SerialNumber } from '@/lib/store'
import { getStoredCompanyData } from '@/lib/company'

const esc = (s: string | undefined | null) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const fmtDate = (d: string | undefined) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return d }
}

const displayWebsite = (website?: string) =>
  (website || 'shop.deed.africa').replace(/^https?:\/\//i, '').replace(/\/$/, '')

export interface DnPrintOptions {
  recipientName?: string
  recipientPhone?: string
  recipientIdNumber?: string
  deliveryAddress?: string
  notes?: string
}

/**
 * Delivery note HTML matching the shared Deed commercial document template
 * (logo + website letterhead, title/meta left, party right, navy table,
 * payment/signature row, contact footer with geometric accent).
 */
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

  const lineRows = delivery.lines.map((line, lineIdx) => {
    if (line.serialIds && line.serialIds.length > 0) {
      return line.serialIds.map((sid, idx) => {
        const ser = serials.find(s => s.id === sid)
        const serialNo   = ser?.serial   || ser?.barcode || sid
        const specs      = ser?.specs    || ''
        return `
          <tr${idx === 0 ? '' : ' class="serial-cont"'}>
            ${idx === 0
              ? `<td class="c" rowspan="${line.serialIds.length}">${lineIdx + 1}</td>
                 <td rowspan="${line.serialIds.length}">${esc(line.productName)}</td>
                 <td rowspan="${line.serialIds.length}" class="c">${line.serialIds.length}</td>`
              : ''}
            <td class="mono">${esc(serialNo)}</td>
            <td>${esc(specs)}</td>
            <td class="sig-cell"></td>
          </tr>`
      }).join('')
    }
    return `
      <tr>
        <td class="c">${lineIdx + 1}</td>
        <td>${esc(line.productName)}</td>
        <td class="c">${line.qty}</td>
        <td colspan="2" class="muted">—</td>
        <td class="sig-cell"></td>
      </tr>`
  }).join('')

  const logoBlock = co.logoUrl
    ? `<img src="${esc(co.logoUrl)}" alt="logo" style="max-height:42px;max-width:128px;object-fit:contain"/>`
    : `<span class="wordmark">deed</span>`

  const website = displayWebsite(co.website)
  const address = [co.address, co.city, co.country || 'Kenya'].filter(Boolean).join(', ')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Delivery Note ${esc(delivery.ref)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#0F172A;background:#E8EEF5}
.page{width:100%;max-width:820px;margin:0 auto 24px;background:#fff;min-height:1120px;position:relative;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,.1)}
.page:after{content:"";position:absolute;right:0;bottom:0;width:220px;height:110px;background:linear-gradient(135deg,transparent 40%,#5B9BD5 40%,#5B9BD5 55%,#1B2762 55%,#1B2762 78%,#94A3B8 78%);pointer-events:none}
.wm{position:absolute;inset:280px 0 auto;text-align:center;font-size:72px;font-weight:900;color:#E6EEF8;letter-spacing:-.04em;pointer-events:none;z-index:0}
.hdr{display:flex;justify-content:space-between;align-items:center;padding:28px 42px 8px;position:relative;z-index:1}
.wordmark{font-size:22px;font-weight:900;color:#1B2762;letter-spacing:-.03em;position:relative}
.wordmark:after{content:"";position:absolute;width:5px;height:5px;border-radius:50%;background:#00AEEF;top:2px;right:-8px}
.website{font-size:11px;color:#94A3B8}
.title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:28px;padding:18px 42px 10px;position:relative;z-index:1}
.dn-title{font-size:28px;font-weight:900;color:#1B2762;letter-spacing:-.03em;line-height:1;margin-bottom:14px}
.meta{font-size:11px;line-height:1.7;color:#0F172A}
.meta b{display:inline-block;min-width:72px}
.party{text-align:right;font-size:11px;line-height:1.7;color:#5B9BD5}
.party-label{font-weight:800}
.party-name{font-size:13px;font-weight:800}
.lines{width:calc(100% - 84px);margin:16px 42px 18px;border-collapse:collapse;font-size:11px;position:relative;z-index:1}
.lines th{padding:10px 10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;background:#1B2762;color:#fff;text-align:left}
.lines td{padding:9px 10px;border:1px solid #CBD5E1;vertical-align:top}
.lines tr:nth-child(even) td{background:#F8FAFC}
.lines .serial-cont td{border-top:1px dashed #CBD5E1}
.c{text-align:center}
.mono{font-family:Consolas,monospace;font-size:10.5px;letter-spacing:0.3px}
.muted{color:#64748B;font-size:10px}
.sig-cell{min-width:56px;width:56px}
.mid{display:grid;grid-template-columns:1.1fr .9fr;gap:24px;margin:0 42px 18px;position:relative;z-index:1}
.notes-label{font-size:11px;font-weight:800;color:#1B2762;margin-bottom:6px;padding-left:10px;border-left:3px solid #00AEEF}
.notes-body{font-size:11px;color:#64748B;line-height:1.6;padding-left:10px}
.sig-block{text-align:left}
.sig-heading{font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748B;margin-bottom:28px}
.sig-line{border-bottom:1px solid #CBD5E1;margin-bottom:6px}
.sig-caption{font-size:10px;color:#64748B;text-align:center}
.ack{margin:0 42px 18px;padding:14px 16px;border:1px solid #E2E8F0;border-radius:4px;position:relative;z-index:1}
.ack-heading{font-size:11px;font-weight:800;color:#1B2762;margin-bottom:12px}
.ack-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.ack-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#64748B;margin-bottom:4px}
.ack-line{border-bottom:1px solid #334155;min-height:28px}
.ack-pre{font-size:11px;font-weight:600;padding:4px 0}
.footer{display:grid;grid-template-columns:1fr 1fr 1.4fr auto;gap:12px;align-items:start;margin:24px 42px 28px;padding-top:14px;border-top:1px solid #CBD5E1;position:relative;z-index:1;font-size:10px;color:#64748B}
.fi{display:flex;gap:8px;align-items:flex-start}
.fi-ico{width:16px;height:16px;border-radius:50%;background:#EFF6FF;border:1px solid #5B9BD5;color:#1B2762;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.pin{font-weight:800;color:#1B2762;text-align:right}
.thanks{text-align:center;font-size:11px;color:#64748B;padding-bottom:36px;position:relative;z-index:1}
@media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{box-shadow:none;margin:0;max-width:none;min-height:auto}}
</style>
</head>
<body>
<div class="page">
  <div class="wm">deed</div>
  <div class="hdr">
    <div>${logoBlock}</div>
    <div class="website">${esc(website)}</div>
  </div>

  <div class="title-row">
    <div>
      <div class="dn-title">DELIVERY NOTE</div>
      <div class="meta">
        <div><b>DN No:</b> ${esc(delivery.ref)}</div>
        <div><b>Date:</b> ${fmtDate(delivery.date)}</div>
        ${delivery.saleOrderRef ? `<div><b>Order Ref:</b> ${esc(delivery.saleOrderRef)}</div>` : ''}
      </div>
    </div>
    <div class="party">
      <div class="party-label">Deliver To:</div>
      <div class="party-name">${esc(delivery.customerName)}</div>
      ${deliveryAddress ? `<div>${esc(deliveryAddress)}</div>` : ''}
      ${recipientName ? `<div>Attn: ${esc(recipientName)}</div>` : ''}
      ${recipientPhone ? `<div>${esc(recipientPhone)}</div>` : ''}
      ${delivery.saleOrderRef ? `<div>Reference: ${esc(delivery.saleOrderRef)}</div>` : ''}
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th style="width:6%">SL.</th>
        <th style="width:34%">Item Description</th>
        <th class="c" style="width:8%">Qty</th>
        <th style="width:22%">Serial / IMEI</th>
        <th style="width:18%">Specs</th>
        <th style="width:12%">Cond. ✓</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows}
    </tbody>
  </table>

  <div class="mid">
    <div>
      ${notes ? `<div class="notes-label">Notes</div><div class="notes-body">${esc(notes)}</div>`
        : delivery.saleOrderRef
          ? `<div class="notes-label">Notes</div><div class="notes-body">Created from ${esc(delivery.saleOrderRef)}.</div>`
          : ''}
    </div>
    <div class="sig-block">
      <div class="sig-heading">Authorised Signature</div>
      <div class="sig-line"></div>
      <div class="sig-caption">Authorised Signature</div>
    </div>
  </div>

  <div class="ack">
    <div class="ack-heading">Receipt Acknowledgement</div>
    <div class="ack-grid">
      <div>
        <div class="ack-label">Received By (Full Name)</div>
        ${recipientName ? `<div class="ack-pre">${esc(recipientName)}</div>` : `<div class="ack-line"></div>`}
      </div>
      <div>
        <div class="ack-label">ID / Passport No.</div>
        ${recipientIdNum ? `<div class="ack-pre">${esc(recipientIdNum)}</div>` : `<div class="ack-line"></div>`}
      </div>
      <div>
        <div class="ack-label">Signature</div>
        <div class="ack-line" style="min-height:40px"></div>
      </div>
      <div>
        <div class="ack-label">Date Received</div>
        <div class="ack-line"></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div class="fi"><div class="fi-ico">T</div><div>${esc(co.phone)}</div></div>
    <div class="fi"><div class="fi-ico">@</div><div>${esc(co.email)}</div></div>
    <div class="fi"><div class="fi-ico">P</div><div>${esc(address)}</div></div>
    <div class="pin">PIN: ${esc(co.kraPin)}</div>
  </div>
  <div class="thanks">${esc(co.invoiceFooter || 'Thank you for your business.')}</div>
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
): boolean {
  const html = generateDeliveryNoteHtml(delivery, serials, options)
  const win  = window.open('', '_blank', 'width=820,height=1000')
  if (!win) {
    alert('Pop-up blocked — please allow pop-ups for this site to print delivery notes.')
    return false
  }
  win.document.write(html)
  win.document.close()
  return true
}
