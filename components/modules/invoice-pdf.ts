import { Invoice, SaleOrder, Delivery, SerialNumber, CompanySettings, BankAccount } from '@/lib/store'
import { CO } from '@/lib/company'

const fmtDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return d
  }
}

export function generateInvoicesHtml(
  invs: Invoice[],
  saleOrders: SaleOrder[],
  deliveries: Delivery[],
  serials: SerialNumber[],
  companySettings: CompanySettings,
  bankAccounts: BankAccount[]
): string {
  const co = companySettings
  const primaryBankAcc = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const fmt = (n: number) => Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const pages = invs.map((inv, invIdx) => {
    const so = saleOrders?.find(s => s.id === inv.saleOrderId)
    const del = deliveries?.find(d => d.saleOrderId === inv.saleOrderId)
    const logoUrl = co.logoUrl ?? ''

    const serialRows = del ? del.lines.flatMap(l =>
      l.serialIds.map(sid => {
        const ser = serials?.find(s => s.id === sid)
        return ser ? `<tr><td>${esc(l.productName)}</td><td>1.00 Units</td><td>${esc(ser.serial)}</td></tr>` : ''
      })
    ).filter(Boolean).join('') : ''

    const lineRows = inv.lines.map(l => `
      <tr>
        <td>${esc(l.description)}</td>
        <td class="r">${Number(l.qty).toFixed(2)} Units</td>
        <td class="r">${fmt(l.unitPrice)}</td>
        <td>${l.taxRate > 0 ? `Sales VAT (${l.taxRate}%)` : ''}</td>
        <td class="r">${fmt(l.subtotal)} KSh</td>
      </tr>`).join('')

    const pageNum = invIdx + 1
    const pageTotal = invs.length

    return `
      <div class="page">
        <!-- ── Header ── -->
        <div class="hdr">
          <div class="logo-cell">
            ${logoUrl
              ? `<img src="${esc(logoUrl)}" alt="logo" style="max-height:56px;max-width:120px;object-fit:contain"/>`
              : `<div class="logo-text">${esc(co.name)}</div>`}
          </div>
          <div class="co-cell">
            <div class="kra">${esc(co.kraPin)}</div>
            <div>${esc(co.name)}</div>
            <div>${esc(co.address)}</div>
            <div>${esc(co.phone)}</div>
            <div>${esc(co.city)}</div>
            <div>Kenya</div>
          </div>
        </div>
        <hr class="rule"/>
        <!-- ── Client block (right-aligned) ── -->
        <div class="client-block">
          <div class="client-name">${esc(inv.partnerName)}</div>
          <div>Nairobi</div>
          <div>Kenya</div>
        </div>
        <!-- ── Invoice title ── -->
        <h1 class="inv-title">${inv.type === 'customer_invoice' ? 'Invoice' : 'Bill'} ${esc(inv.ref)}</h1>
        <!-- ── Dates row ── -->
        <div class="dates-row">
          <div><div class="date-lbl">Invoice Date:</div><div>${fmtDate(inv.date)}</div></div>
          <div><div class="date-lbl">Due Date:</div><div>${fmtDate(inv.dueDate)}</div></div>
          ${so ? `<div><div class="date-lbl">Source:</div><div>${esc(so.ref)}</div></div>` : ''}
        </div>
        <!-- ── Line items table ── -->
        <table class="lines">
          <thead><tr><th>DESCRIPTION</th><th class="r">QUANTITY</th><th class="r">UNIT PRICE</th><th>TAXES</th><th class="r">AMOUNT</th></tr></thead>
          <tbody>
            ${lineRows}
            <tr class="subtotal-row"><td colspan="4" class="r"><b>Subtotal</b></td><td class="r"><b>${fmt(inv.subtotal)} KSh</b></td></tr>
          </tbody>
        </table>
        ${serialRows ? `<table class="serials"><thead><tr><th>PRODUCT</th><th>QUANTITY</th><th>SN/LN</th></tr></thead><tbody>${serialRows}</tbody></table>` : ''}
        <!-- ── Totals block (right-aligned) ── -->
        <div class="totals-wrap">
          <table class="totals-tbl">
            <tr><td class="tl">Untaxed Amount</td><td class="tr">${fmt(inv.subtotal)} KSh</td></tr>
            ${inv.taxTotal > 0 ? `<tr><td class="tl">TVA ${co.vatRate ?? 16}%</td><td class="tr">${fmt(inv.taxTotal)} KSh</td></tr>` : ''}
            ${inv.amountPaid > 0 ? `<tr><td class="tl">Amount Paid</td><td class="tr" style="color:#059669">− ${fmt(inv.amountPaid)} KSh</td></tr>` : ''}
            <tr class="total-final"><td class="tl"><b>Total</b></td><td class="tr"><b>${fmt(inv.total)} KSh</b></td></tr>
          </table>
        </div>
        <!-- ── Payment ref ── -->
        <div class="pay-ref">Please use the following communication for your payment : <b>${esc(inv.ref)}</b></div>
        <!-- ── Payment details ── -->
        <div class="pay-section">
          ${primaryBankAcc ? `<div class="pay-heading">PAYMENT DETAILS</div><div>Account Name: ${esc(co.name.toUpperCase())}</div><div>Account number: ${esc(primaryBankAcc.accountNo)} (KES)</div><div>Bank: ${esc(primaryBankAcc.bankName)}</div><div>Branch: ${esc(CO.bankBranch)}</div><div>Bank Code: ${esc(CO.bankCode)}</div><div>Branch code: ${esc(CO.branchCode)}</div><div>SWIFT CODE: ${esc(CO.swiftCode)}</div>` : ''}
          ${co.mpesaPaybill ? `<div class="pay-heading" style="margin-top:10px">MPESA</div><div>PAY BILL NO: ${esc(co.mpesaPaybill)}</div><div>Account number: ${esc(co.mpesaAccount)} (KES)</div>` : ''}
        </div>
        <!-- ── Footer ── -->
        <div class="pg-footer"><div>Thank you for your business</div><div>${esc(co.website)}</div><div>Page: ${pageNum} / ${pageTotal}</div></div>
      </div>`
  }).join('')

  const css = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;background:#fff}.page{width:100%;max-width:780px;margin:0 auto;padding:24px 36px;page-break-after:always}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}.logo-cell{flex:0 0 130px}.logo-text{font-size:18px;font-weight:700;color:#1B2762}.co-cell{text-align:right;font-size:11px;line-height:1.55}.kra{font-size:10px;color:#555;margin-bottom:2px}.rule{border:none;border-top:1px solid #aaa;margin:6px 0 10px}.client-block{text-align:right;font-size:11px;line-height:1.6;margin-bottom:10px}.client-name{font-weight:600;font-size:12px}.inv-title{font-size:28px;font-weight:700;color:#1B2762;margin-bottom:14px}.dates-row{display:flex;gap:48px;margin-bottom:14px;font-size:11px}.date-lbl{font-weight:700}.lines{width:100%;border-collapse:collapse;margin-bottom:0;font-size:11px}.lines th{padding:6px 8px;font-size:10px;font-weight:700;border:1px solid #bbb;background:#f5f5f5;text-align:left}.lines td{padding:5px 8px;border:1px solid #ddd}.subtotal-row td{background:#f9f9f9;border-top:1.5px solid #bbb}.r{text-align:right!important}.serials{border-collapse:collapse;margin:8px 0;font-size:10px}.serials th{background:#f5f5f5;padding:4px 10px;font-weight:700;border:1px solid #ccc}.serials td{padding:4px 10px;border:1px solid #ddd}.totals-wrap{display:flex;justify-content:flex-end;margin:10px 0 12px}.totals-tbl{border-collapse:collapse;font-size:11px;min-width:260px}.totals-tbl td{padding:4px 10px;border:1px solid #ddd}.tl{background:#f0f4ff;color:#333}.tr{text-align:right;background:#fff}.total-final td{background:#1B2762 !important;color:#fff !important;font-size:12px}.pay-ref{font-size:11px;margin-bottom:10px}.pay-section{font-size:11px;line-height:1.8;margin-bottom:12px}.pay-heading{font-weight:700;margin-top:4px;margin-bottom:2px}.pg-footer{text-align:center;font-size:10px;color:#666;padding-top:10px;border-top:1px solid #ccc;line-height:1.7;margin-top:auto}@media print{.page{page-break-after:always}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoices</title><style>${css}</style></head><body>${pages}</body></html>`
}