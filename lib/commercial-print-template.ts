import type { BankAccount, CompanySettings } from '@/lib/store'
import { CO } from '@/lib/company'

export type PrintTemplateId = 'classic' | 'modern' | 'compact'

export const PRINT_TEMPLATES: Array<{ id: PrintTemplateId; label: string; description: string }> = [
  { id: 'classic', label: 'Classic Corporate', description: 'Formal letterhead with right-aligned company details.' },
  { id: 'modern', label: 'Modern Blue', description: 'Bold blue header, card totals, and clean section blocks.' },
  { id: 'compact', label: 'Compact Ledger', description: 'Dense accounting layout for printing many lines.' },
]

type CommercialLine = {
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

const lineRows = (doc: CommercialDocument) => doc.lines.map(line => `
  <tr>
    <td>${esc(line.description)}</td>
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
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:11px}
    .page{width:100%;max-width:800px;margin:0 auto;padding:30px 38px;page-break-after:always}
    .header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.logo{max-height:62px;max-width:130px;object-fit:contain}.logo-fallback{font-weight:900;font-size:20px;color:#1B2762}
    .company-block{text-align:right;line-height:1.55;color:#374151}.co-name{font-weight:800;color:#111827}.bank-line{font-size:10px;color:#4B5563}
    .doc-title{font-size:28px;margin:22px 0 12px;color:#1B2762}.meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:12px 0 18px}.meta b{display:block;font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.08em}
    .client{margin:14px 0 18px;line-height:1.5}.client b{font-size:13px}.lines{width:100%;border-collapse:collapse}.lines th{font-size:9px;text-transform:uppercase;letter-spacing:.08em;text-align:left}.lines th,.lines td{padding:8px;border-bottom:1px solid #E5E7EB}.r{text-align:right}.totals-wrap{display:flex;justify-content:flex-end;margin-top:14px}.totals{min-width:280px;border-collapse:collapse}.totals td{padding:7px 10px;border-bottom:1px solid #E5E7EB}.totals .grand td{font-weight:900;font-size:13px}.paid{color:#059669}.notes{margin-top:18px;padding-top:12px;border-top:1px solid #E5E7EB;color:#4B5563;white-space:pre-wrap}.footer{text-align:center;margin-top:28px;padding-top:12px;border-top:1px solid #E5E7EB;color:#6B7280;font-size:10px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{page-break-after:always}}
  `
  if (template === 'modern') return `${base}
    .page{padding:0 0 30px}.header{padding:30px 38px;background:linear-gradient(135deg,#1B2762,#2563EB);color:#fff}.company-block,.company-block .co-name,.company-block .bank-line{color:#fff}.logo-fallback{color:#fff}.doc-title{margin:26px 38px 12px}.meta,.client,.lines,.notes,.footer{margin-left:38px;margin-right:38px}.lines th{background:#EEF2FF;color:#1B2762}.totals-wrap{margin-right:38px}.totals .grand td{background:#1B2762;color:#fff}`
  if (template === 'compact') return `${base}
    body{font-size:10px}.page{max-width:760px;padding:18px 24px}.doc-title{font-size:22px;margin:12px 0 8px}.meta{margin:8px 0 10px}.client{margin:8px 0 10px}.lines th,.lines td{padding:5px}.totals td{padding:5px 8px}.footer{margin-top:16px}`
  return `${base}.header{border-bottom:2px solid #1B2762;padding-bottom:12px}.lines th{background:#F8FAFC;color:#4B5563}.totals .grand td{background:#F0F4FF;color:#1B2762}`
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
      <h1 class="doc-title">${esc(doc.title)} ${esc(doc.ref)}</h1>
      <div class="meta">
        <div><b>Date</b>${fmtDate(doc.date)}</div>
        ${doc.dueDate ? `<div><b>Due / Valid Until</b>${fmtDate(doc.dueDate)}</div>` : '<div></div>'}
        <div><b>Status</b>${esc(doc.status || '')}</div>
      </div>
      <div class="client"><b>${esc(doc.customerName)}</b>${doc.customerAddress ? `<br/>${esc(doc.customerAddress)}` : ''}${doc.sourceRef ? `<br/>Source: ${esc(doc.sourceRef)}` : ''}</div>
      <table class="lines">
        <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead>
        <tbody>${lineRows(doc)}</tbody>
      </table>
      <div class="totals-wrap">${totalsBlock(doc, company)}</div>
      ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ''}
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
