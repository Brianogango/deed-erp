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

const companyBlock = (company: CompanySettings, primaryBank?: BankAccount) => `
  <div class="company-block">
    <div class="co-name">${esc(company.name)}</div>
    <div>${esc(company.address)}, ${esc(company.city)}</div>
    <div>Tel: ${esc(company.phone)}${company.email ? ` · ${esc(company.email)}` : ''}</div>
    ${company.website ? `<div>${esc(company.website)}</div>` : ''}
    ${company.kraPin ? `<div>KRA PIN: ${esc(company.kraPin)}</div>` : ''}
    ${primaryBank ? `<div class="bank-line">Bank: ${esc(primaryBank.bankName)} · ${esc(primaryBank.accountNo)}</div>` : ''}
    ${company.mpesaPaybill ? `<div class="bank-line">M-Pesa Paybill: ${esc(company.mpesaPaybill)} · Acct: ${esc(company.mpesaAccount)}</div>` : ''}
  </div>`

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
    .header{display:grid;grid-template-columns:1fr 1.35fr;gap:28px;align-items:start;padding:36px 42px 26px;background:linear-gradient(135deg,#F8FAFC 0%,#EEF6FF 100%);border-bottom:1px solid #DDE7F3}
    .logo{max-height:74px;max-width:150px;object-fit:contain}.logo-fallback{display:inline-flex;align-items:center;justify-content:center;min-width:118px;min-height:58px;border-radius:18px;background:#1B2762;color:#fff;font-weight:950;font-size:19px;letter-spacing:-.02em;padding:12px 16px}
    .company-block{text-align:right;line-height:1.58;color:#475569;font-size:10.5px}.co-name{font-size:16px;font-weight:950;color:#0F172A;letter-spacing:-.02em}.bank-line{font-size:10px;color:#1B2762;font-weight:700}
    .doc-bar{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:28px 42px 18px}.doc-title{font-size:30px;line-height:1;margin:0;color:#0F172A;letter-spacing:-.045em;font-weight:950}.doc-ref{font-size:13px;color:#1B2762;font-weight:900;margin-top:7px}.status-pill{display:inline-flex;border:1px solid #D9E4F1;border-radius:999px;padding:7px 12px;font-size:9px;font-weight:950;text-transform:uppercase;letter-spacing:.08em;color:#1B2762;background:#F8FAFC}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 42px 20px}.meta>div,.client{border:1px solid #E2E8F0;border-radius:16px;background:#fff;padding:13px 14px;box-shadow:0 1px 2px rgba(15,23,42,.04)}.meta b,.client-label{display:block;font-size:9px;color:#64748B;text-transform:uppercase;letter-spacing:.09em;margin-bottom:5px;font-weight:900}.client{margin:0 42px 22px;line-height:1.55}.client b{font-size:14px;color:#0F172A}
    .lines-wrap{margin:0 42px}.lines{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid #E2E8F0;border-radius:16px}.lines th{font-size:9px;text-transform:uppercase;letter-spacing:.09em;text-align:left;background:#10204A;color:#fff;padding:11px 12px}.lines td{padding:11px 12px;border-bottom:1px solid #E2E8F0;vertical-align:top}.lines tbody tr:nth-child(even) td{background:#F8FAFC}.lines tbody tr:last-child td{border-bottom:0}.lines .section-row td{background:#EAF1FF !important;color:#1B2762;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.line-title{font-weight:750;color:#0F172A}.r{text-align:right;white-space:nowrap}.totals-wrap{display:flex;justify-content:flex-end;margin:18px 42px 0}.totals{min-width:320px;border-collapse:separate;border-spacing:0;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;background:#fff}.totals td{padding:9px 13px;border-bottom:1px solid #E2E8F0}.totals tr:last-child td{border-bottom:0}.totals .grand td{font-weight:950;font-size:15px;background:#1B2762;color:#fff}.paid{color:#059669;font-weight:800}.notes{margin:20px 42px 0;padding:14px 16px;border:1px solid #E2E8F0;border-radius:16px;background:#F8FAFC;color:#475569;white-space:pre-wrap;line-height:1.55}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:28px 42px 0}.sig{border-top:1.5px solid #94A3B8;padding-top:8px;color:#64748B;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}.footer{text-align:center;margin:28px 42px 0;padding:14px 0 24px;border-top:1px solid #E2E8F0;color:#64748B;font-size:10px;line-height:1.55}
    @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{box-shadow:none;margin:0;max-width:none;min-height:auto;page-break-after:always}}
  `
  if (template === 'modern') return `${base}
    .header{background:linear-gradient(135deg,#1B2762,#2563EB);color:#fff}.company-block,.company-block .co-name,.company-block .bank-line{color:#fff}.logo-fallback{background:#fff;color:#1B2762}.doc-title{color:#1B2762}.lines th{background:#1B2762}.totals .grand td{background:#1B2762;color:#fff}`
  if (template === 'compact') return `${base}
    body{font-size:10px}.page{max-width:780px;min-height:auto}.header{padding:22px 28px 16px}.doc-bar{padding:18px 28px 12px}.doc-title{font-size:24px}.meta{margin:0 28px 12px}.client{margin:0 28px 14px}.lines-wrap{margin:0 28px}.lines th,.lines td{padding:6px 8px}.totals-wrap{margin:12px 28px 0}.totals td{padding:6px 8px}.notes{margin:14px 28px 0}.signatures{margin:20px 28px 0}.footer{margin:18px 28px 0;padding-bottom:14px}`
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
        <div>${company.logoUrl ? `<img class="logo" src="${esc(company.logoUrl)}" alt="logo"/>` : `<div class="logo-fallback">${esc(company.name)}</div>`}</div>
        ${companyBlock(company, primaryBank)}
      </div>
      <div class="doc-bar">
        <div>
          <h1 class="doc-title">${esc(doc.title)}</h1>
          <div class="doc-ref">${esc(doc.ref)}</div>
        </div>
        <div class="status-pill">${esc(doc.status || 'Draft')}</div>
      </div>
      <div class="meta">
        <div><b>Date</b>${fmtDate(doc.date)}</div>
        ${doc.dueDate ? `<div><b>Due / Valid Until</b>${fmtDate(doc.dueDate)}</div>` : '<div></div>'}
        <div><b>Currency</b>${esc(company.currency || 'KES')}</div>
      </div>
      <div class="client"><span class="client-label">Bill To / Customer</span><b>${esc(doc.customerName)}</b>${doc.customerAddress ? `<br/>${esc(doc.customerAddress)}` : ''}${doc.sourceRef ? `<br/>Source: ${esc(doc.sourceRef)}` : ''}</div>
      <div class="lines-wrap">
        <table class="lines">
          <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead>
          <tbody>${lineRows(doc)}</tbody>
        </table>
      </div>
      <div class="totals-wrap">${totalsBlock(doc, company)}</div>
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
