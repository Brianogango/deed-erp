import type { BankAccount, CompanySettings } from '@/lib/store'
import { CO } from '@/lib/company'

export type PrintTemplateId = 'classic' | 'modern' | 'compact'

export const PRINT_TEMPLATES: Array<{ id: PrintTemplateId; label: string; description: string }> = [
  { id: 'classic', label: 'Classic Corporate', description: 'Formal letterhead with right-aligned company details.' },
  { id: 'modern', label: 'Modern Blue', description: 'Bold blue header, card totals, and clean section blocks.' },
  { id: 'compact', label: 'Compact Ledger', description: 'Dense accounting layout for printing many lines.' },
]

type CommercialLine = {
  lineType?: 'item' | 'section'
  description: string
  qty: number
  unitPrice: number
  taxRate?: number
  subtotal: number
}

export type CommercialDocument = {
  title: string
  ref: string
  status?: string
  date: string
  dueDate?: string
  customerName: string
  customerAddress?: string
  sourceRef?: string
  lines: CommercialLine[]
  subtotal: number
  taxTotal: number
  total: number
  amountPaid?: number
  notes?: string
}

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = (value: number) => Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (value: string) => {
  try { return new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return value }
}

const initials = (name: string) =>
  String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0]).join('').toUpperCase() || '—'

const companyBlock = (company: CompanySettings) => `
  <div class="company-block">
    <div class="co-name">${esc(company.name)}</div>
    <div>${esc(company.address)}, ${esc(company.city)}</div>
    <div>Tel: ${esc(company.phone)}${company.email ? ` · ${esc(company.email)}` : ''}</div>
    ${company.kraPin ? `<div>KRA PIN: ${esc(company.kraPin)}</div>` : ''}
  </div>`

const paymentBlock = (company: CompanySettings, primaryBank?: BankAccount) => {
  const bankBits = primaryBank
    ? [`Bank: ${esc(primaryBank.bankName)}`, primaryBank.accountNo ? `Acct: ${esc(primaryBank.accountNo)}` : '']
    : []
  const mpesaBits = company.mpesaPaybill
    ? [`M-Pesa Paybill: ${esc(company.mpesaPaybill)}`, company.mpesaAccount ? `Acct: ${esc(company.mpesaAccount)}` : '']
    : []
  const parts = [
    bankBits.filter(Boolean).join(' · '),
    mpesaBits.filter(Boolean).join(' · '),
  ].filter(Boolean)
  if (!parts.length) return ''
  return `<div class="pay-strip"><span class="pay-label">Payment details</span>${parts.join('<span class="pay-sep">|</span>')}</div>`
}

const lineRows = (doc: CommercialDocument) => doc.lines.map(line => line.lineType === 'section' ? `
  <tr class="section-row">
    <td colspan="5">${esc(line.description)}</td>
  </tr>
` : `
  <tr>
    <td><span class="line-title">${esc(line.description)}</span></td>
    <td class="r">${fmt(line.qty)}</td>
    <td class="r">${fmt(line.unitPrice)}</td>
    <td class="r">${line.taxRate ? `${fmt(line.taxRate)}%` : ''}</td>
    <td class="r">${fmt(line.subtotal)}</td>
  </tr>
`).join('')

const totalsBlock = (doc: CommercialDocument, company: CompanySettings) => `
  <table class="totals">
    <tr><td>Untaxed Amount</td><td class="r">${fmt(doc.subtotal)} ${esc(company.currency)}</td></tr>
    ${doc.taxTotal ? `<tr><td>VAT</td><td class="r">${fmt(doc.taxTotal)} ${esc(company.currency)}</td></tr>` : ''}
    ${doc.amountPaid ? `<tr><td>Amount Paid</td><td class="r paid">-${fmt(doc.amountPaid)} ${esc(company.currency)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="r">${fmt(doc.total)} ${esc(company.currency)}</td></tr>
  </table>`

const cssFor = (template: PrintTemplateId) => {
  const base = `
    *{box-sizing:border-box}body{margin:0;background:#F3F6FB;color:#0F172A;font-family:Inter,Arial,Helvetica,sans-serif;font-size:11px}
    .page{width:100%;max-width:820px;min-height:1120px;margin:0 auto 24px;background:#fff;page-break-after:always;box-shadow:0 28px 80px rgba(15,23,42,.12);position:relative;overflow:hidden}
    .page:before{content:"";position:absolute;inset:0 0 auto;height:7px;background:linear-gradient(90deg,#1B2762,#00AEEF,#10B981)}
    .header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 42px 14px;background:linear-gradient(135deg,#F8FAFC 0%,#EEF6FF 100%);border-bottom:1px solid #DDE7F3}
    .logo{max-height:50px;max-width:130px;object-fit:contain}.logo-fallback{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:12px;background:#1B2762;color:#fff;font-weight:950;font-size:16px;letter-spacing:.01em}
    .company-block{text-align:right;line-height:1.5;color:#475569;font-size:10px}.co-name{font-size:12.5px;font-weight:950;color:#0F172A;letter-spacing:-.01em}
    .doc-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 42px 4px}.doc-title{font-size:17px;line-height:1;margin:0;color:#0F172A;letter-spacing:-.02em;font-weight:950;text-transform:uppercase}.status-pill{display:inline-flex;border:1px solid #D9E4F1;border-radius:999px;padding:3px 9px;font-size:8px;font-weight:950;text-transform:uppercase;letter-spacing:.08em;color:#1B2762;background:#F8FAFC}
    .meta-line{display:flex;flex-wrap:wrap;gap:5px 18px;margin:0 42px 14px;padding-bottom:10px;border-bottom:1px solid #E2E8F0;color:#0F172A;font-size:10.5px;font-weight:700}.meta-line b{font-size:8.5px;color:#64748B;text-transform:uppercase;letter-spacing:.08em;margin-right:5px;font-weight:900}
    .client{border:1px solid #E2E8F0;border-radius:16px;background:#fff;padding:13px 14px;box-shadow:0 1px 2px rgba(15,23,42,.04)}.client-label{display:block;font-size:9px;color:#64748B;text-transform:uppercase;letter-spacing:.09em;margin-bottom:5px;font-weight:900}.client{margin:0 42px 18px;line-height:1.55}.client b{font-size:14px;color:#0F172A}
    .lines-wrap{margin:0 42px}.lines{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid #E2E8F0;border-radius:16px}.lines th{font-size:9px;text-transform:uppercase;letter-spacing:.09em;text-align:left;background:#10204A;color:#fff;padding:11px 12px}.lines td{padding:11px 12px;border-bottom:1px solid #E2E8F0;vertical-align:top}.lines tbody tr:nth-child(even) td{background:#F8FAFC}.lines tbody tr:last-child td{border-bottom:0}.lines .section-row td{background:#EAF1FF !important;color:#1B2762;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.line-title{font-weight:750;color:#0F172A}.r{text-align:right;white-space:nowrap}.totals-wrap{display:flex;justify-content:flex-end;margin:18px 42px 0}.totals{min-width:320px;border-collapse:separate;border-spacing:0;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;background:#fff}.totals td{padding:9px 13px;border-bottom:1px solid #E2E8F0}.totals tr:last-child td{border-bottom:0}.totals .grand td{font-weight:950;font-size:15px;background:#1B2762;color:#fff}.paid{color:#059669;font-weight:800}.pay-strip{margin:14px 42px 0;padding:9px 14px;border:1px solid #DDE7F3;border-radius:12px;background:#F8FAFC;color:#1B2762;font-size:10px;font-weight:700;line-height:1.6}.pay-label{display:inline-block;font-size:8.5px;color:#64748B;text-transform:uppercase;letter-spacing:.08em;font-weight:900;margin-right:10px}.pay-sep{margin:0 8px;color:#94A3B8;font-weight:400}.notes{margin:20px 42px 0;padding:14px 16px;border:1px solid #E2E8F0;border-radius:16px;background:#F8FAFC;color:#475569;white-space:pre-wrap;line-height:1.55}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:28px 42px 0}.sig{border-top:1.5px solid #94A3B8;padding-top:8px;color:#64748B;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}.footer{text-align:center;margin:28px 42px 0;padding:14px 0 24px;border-top:1px solid #E2E8F0;color:#64748B;font-size:10px;line-height:1.55}
    @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{box-shadow:none;margin:0;max-width:none;min-height:auto;page-break-after:always}}
  `
  if (template === 'modern') return `${base}
    .header{background:linear-gradient(135deg,#1B2762,#2563EB);color:#fff}.company-block,.company-block .co-name{color:#fff}.logo-fallback{background:#fff;color:#1B2762}.doc-title{color:#1B2762}.lines th{background:#1B2762}.totals .grand td{background:#1B2762;color:#fff}`
  if (template === 'compact') return `${base}
    body{font-size:10px}.page{max-width:780px;min-height:auto}.header{padding:14px 28px 10px}.doc-bar{padding:12px 28px 2px}.doc-title{font-size:14px}.meta-line{margin:0 28px 10px;padding-bottom:8px}.client{margin:0 28px 12px}.lines-wrap{margin:0 28px}.lines th,.lines td{padding:6px 8px}.totals-wrap{margin:12px 28px 0}.totals td{padding:6px 8px}.pay-strip{margin:10px 28px 0}.notes{margin:14px 28px 0}.signatures{margin:20px 28px 0}.footer{margin:18px 28px 0;padding-bottom:14px}`
  return `${base}.lines th{background:#1B2762}.totals .grand td{background:#1B2762;color:#fff}`
}

export function generateCommercialDocumentHtml(
  docs: CommercialDocument[],
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
  template: PrintTemplateId = (company.printTemplate as PrintTemplateId) || 'classic',
) {
  const primaryBank = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')
  const pages = docs.map(doc => `
    <div class="page">
      <div class="header">
        <div>${company.logoUrl ? `<img class="logo" src="${esc(company.logoUrl)}" alt="logo"/>` : `<div class="logo-fallback">${initials(company.name)}</div>`}</div>
        ${companyBlock(company)}
      </div>
      <div class="doc-bar">
        <h1 class="doc-title">${esc(doc.title)}</h1>
        <div class="status-pill">${esc(doc.status || 'Draft')}</div>
      </div>
      <div class="meta-line">
        <span><b>Ref</b>${esc(doc.ref)}</span>
        <span><b>Date</b>${fmtDate(doc.date)}</span>
        ${doc.dueDate ? `<span><b>Due / Valid Until</b>${fmtDate(doc.dueDate)}</span>` : ''}
        <span><b>Currency</b>${esc(company.currency || 'KES')}</span>
      </div>
      <div class="client"><span class="client-label">Bill To / Customer</span><b>${esc(doc.customerName)}</b>${doc.customerAddress ? `<br/>${esc(doc.customerAddress)}` : ''}${doc.sourceRef ? `<br/>Source: ${esc(doc.sourceRef)}` : ''}</div>
      <div class="lines-wrap">
        <table class="lines">
          <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead>
          <tbody>${lineRows(doc)}</tbody>
        </table>
      </div>
      <div class="totals-wrap">${totalsBlock(doc, company)}</div>
      ${paymentBlock(company, primaryBank)}
      ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ''}
      <div class="signatures"><div class="sig">Prepared by</div><div class="sig">Approved / Received by</div></div>
      <div class="footer">${esc(company.invoiceFooter || 'Thank you for your business.')} ${company.website ? ` · ${esc(company.website)}` : ''}</div>
    </div>
  `).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Documents</title><style>${cssFor(template)}</style></head><body>${pages}</body></html>`
}

export function downloadCommercialDocumentHtml(fileName: string, html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
