/**
 * One look for every email the ERP sends: logo on a white header, a thin
 * brand bar, one clear title, the message, buttons that work in Outlook, and
 * a footer with the company's details.
 *
 * Email HTML is old-fashioned on purpose: tables for layout, inline styles,
 * a PNG logo by absolute URL (Gmail and Outlook do not show SVG or relative
 * images), and a light-only colour scheme so dark-mode apps do not repaint
 * the header into an odd purple.
 */
import { CO } from '@/lib/company'

export const escapeEmailHtml = (value: string) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const NAVY = '#1B2762'
const CYAN = '#00AEEF'
const INK = '#0F172A'
const MUTED = '#64748B'
const LINE = '#E2E8F0'
const PAGE = '#F1F5F9'
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export function appBaseUrl(): string {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://erp.deed.co.ke').replace(/\/+$/, '')
}

function absoluteUrl(url: string | null | undefined): string | null {
  const value = String(url || '').trim()
  if (!value) return null
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value
  return `${appBaseUrl()}${value.startsWith('/') ? '' : '/'}${value}`
}

export type BrandedAction = { label: string; url: string; tone?: 'primary' | 'secondary' | 'success' | 'danger' }

const BUTTON: Record<NonNullable<BrandedAction['tone']>, { bg: string; fg: string; border: string }> = {
  primary: { bg: NAVY, fg: '#FFFFFF', border: NAVY },
  secondary: { bg: '#FFFFFF', fg: NAVY, border: '#CBD5E1' },
  success: { bg: '#15803D', fg: '#FFFFFF', border: '#15803D' },
  danger: { bg: '#B91C1C', fg: '#FFFFFF', border: '#B91C1C' },
}

/** A table-cell button: Outlook ignores padding and background on a bare link. */
export function emailButtonHtml(action: BrandedAction): string {
  const href = absoluteUrl(action.url)
  if (!href) return ''
  const c = BUTTON[action.tone || 'primary']
  return `<td style="padding:0 10px 10px 0"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${c.bg}" style="background:${c.bg};border:1px solid ${c.border};border-radius:8px"><a href="${escapeEmailHtml(href)}" target="_blank" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1;color:${c.fg};text-decoration:none;border-radius:8px">${escapeEmailHtml(action.label)}</a></td></tr></table></td>`
}

/**
 * Plain text from a notification → tidy HTML. Lines that start with "• " (the
 * digests: cheques due, overdue invoices…) become a ruled list; blank lines
 * split paragraphs.
 */
export function textToEmailHtml(text: string): string {
  const blocks: string[] = []
  let list: string[] = []
  let para: string[] = []
  const flushList = () => {
    if (!list.length) return
    blocks.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 18px;border:1px solid ${LINE};border-radius:10px">${list
      .map((item, i) => `<tr><td style="padding:12px 14px;${i ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:14px;line-height:1.5;color:${INK}">${escapeEmailHtml(item)}</td></tr>`)
      .join('')}</table>`)
    list = []
  }
  const flushPara = () => {
    if (!para.length) return
    blocks.push(`<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">${para.map(escapeEmailHtml).join('<br>')}</p>`)
    para = []
  }
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    const bullet = /^\s*[•\-*]\s+(.*)$/.exec(line)
    if (bullet) { flushPara(); list.push(bullet[1]); continue }
    if (!line.trim()) { flushPara(); flushList(); continue }
    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return blocks.join('')
}

export type BrandedEmailInput = {
  /** The one heading in the message. */
  title: string
  /** Ready HTML for the message body (use textToEmailHtml for plain text). */
  bodyHtml: string
  /** Small label above the title, e.g. "Accounts" or "Quotation". */
  eyebrow?: string
  /** Shown by mail apps beside the subject; not visible in the message. */
  preheader?: string
  actions?: BrandedAction[]
  /** A short line under the buttons, e.g. why the reader got this. */
  footnote?: string
  /** Sign-off after the buttons ("Kind regards, …"), as ready HTML. */
  signatureHtml?: string
  /** Company name override (defaults to PDF_COMPANY_NAME / company constants). */
  companyName?: string
}

export function brandedEmailHtml(input: BrandedEmailInput): string {
  const company = input.companyName || process.env.PDF_COMPANY_NAME || CO.name
  const logo = `${appBaseUrl()}/email-logo.png`
  const buttons = (input.actions ?? []).map(emailButtonHtml).filter(Boolean).join('')
  const contact = [
    [CO.address, CO.city].filter(Boolean).join(', '),
    CO.phone,
    CO.email ? `<a href="mailto:${escapeEmailHtml(CO.email)}" style="color:${MUTED};text-decoration:underline">${escapeEmailHtml(CO.email)}</a>` : '',
    CO.website ? `<a href="${escapeEmailHtml(CO.website)}" style="color:${MUTED};text-decoration:underline">${escapeEmailHtml(CO.website.replace(/^https?:\/\//, ''))}</a>` : '',
  ].filter(Boolean)

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeEmailHtml(input.title)}</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light; }
  a { color: ${NAVY}; }
  @media (max-width: 620px) {
    .deed-card { border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
    .deed-pad { padding-left: 20px !important; padding-right: 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE}">${escapeEmailHtml(input.preheader || input.title)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${PAGE}" style="background:${PAGE}">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" class="deed-card" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
      <tr><td height="4" bgcolor="${CYAN}" style="height:4px;line-height:4px;font-size:0;background:${CYAN}">&nbsp;</td></tr>
      <tr><td class="deed-pad" style="padding:22px 32px 18px;border-bottom:1px solid ${LINE}">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
          <td align="left" valign="middle"><img src="${logo}" width="80" height="56" alt="${escapeEmailHtml(company)}" style="display:block;border:0;outline:none;text-decoration:none;height:56px;width:80px"></td>
          ${input.eyebrow ? `<td align="right" valign="middle" style="font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${escapeEmailHtml(input.eyebrow)}</td>` : ''}
        </tr></table>
      </td></tr>
      <tr><td class="deed-pad" style="padding:28px 32px 12px">
        <h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${NAVY}">${escapeEmailHtml(input.title)}</h1>
        ${input.bodyHtml}
        ${buttons ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 8px"><tr>${buttons}</tr></table>` : ''}
        ${input.footnote ? `<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED}">${escapeEmailHtml(input.footnote)}</p>` : ''}
        ${input.signatureHtml ?? ''}
      </td></tr>
      <tr><td class="deed-pad" style="padding:20px 32px 26px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid ${LINE}"><tr><td style="padding-top:16px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">
          <strong style="color:${INK};font-weight:600">${escapeEmailHtml(company)}</strong><br>
          ${contact.join(' &nbsp;·&nbsp; ')}
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

/** An email body that is only a fragment (no <html>) gets the branded frame. */
export function wrapEmailFragment(html: string, subject: string): string {
  if (/<html[\s>]/i.test(html) || /<!doctype/i.test(html)) return html
  return brandedEmailHtml({ title: subject, bodyHtml: `<div style="font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">${html}</div>` })
}

/** A clean items table for quotes, RFQs and receipts. `align` per column: 'l' | 'c' | 'r'. */
export function emailTableHtml(headers: string[], rows: Array<Array<string | number>>, align: Array<'l' | 'c' | 'r'> = []): string {
  const a = (i: number) => (align[i] === 'r' ? 'right' : align[i] === 'c' ? 'center' : 'left')
  const head = headers.map((h, i) => `<th align="${a(i)}" style="padding:10px 12px;background:#F8FAFC;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:${MUTED};text-align:${a(i)}">${escapeEmailHtml(h)}</th>`).join('')
  const body = rows.map((r, ri) => `<tr>${r.map((c, i) => `<td align="${a(i)}" style="padding:11px 12px;${ri ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:14px;line-height:1.45;color:${INK};text-align:${a(i)}">${escapeEmailHtml(String(c))}</td>`).join('')}</tr>`).join('')
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 16px;border:1px solid ${LINE};border-radius:10px;border-collapse:separate;overflow:hidden"><tr>${head}</tr>${body}</table>`
}

/** Label / value rows under a table: Subtotal, VAT, Total… The last can be emphasised. */
export function emailTotalsHtml(rows: Array<[string, string]>, emphasiseLast = true): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px">${rows.map(([k, v], i) => {
    const strong = emphasiseLast && i === rows.length - 1
    return `<tr><td align="right" style="padding:3px 12px 3px 0;font-family:${FONT};font-size:${strong ? 15 : 13}px;color:${strong ? INK : MUTED};${strong ? 'font-weight:700;' : ''}">${escapeEmailHtml(k)}</td><td align="right" width="150" style="padding:3px 0;font-family:${FONT};font-size:${strong ? 17 : 14}px;color:${strong ? NAVY : INK};font-weight:${strong ? 700 : 500};white-space:nowrap">${escapeEmailHtml(v)}</td></tr>`
  }).join('')}</table>`
}

/** "Kind regards, Name, line" as a sign-off. */
export function emailSignature(lines: Array<string | { email: string }>): string {
  const parts = lines.filter(Boolean).map((l, i) => typeof l === 'string'
    ? (i === 1 ? `<strong>${escapeEmailHtml(l)}</strong>` : escapeEmailHtml(l))
    : `<a href="mailto:${escapeEmailHtml(l.email)}" style="color:${NAVY}">${escapeEmailHtml(l.email)}</a>`)
  return `<p style="margin:18px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">${parts.join('<br>')}</p>`
}

/** A paragraph of plain text (escaped; new lines kept). */
export function emailParagraph(text: string, muted = false): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:${muted ? 13 : 15}px;line-height:1.6;color:${muted ? MUTED : INK}">${escapeEmailHtml(text).replace(/\r?\n/g, '<br>')}</p>`
}

/** Plain HTML (paragraphs, lists, small tables) inside the branded frame, with the email font applied. */
export function brandedEmailFromHtml(input: Omit<BrandedEmailInput, 'bodyHtml'> & { html: string }): string {
  const { html, ...rest } = input
  return brandedEmailHtml({ ...rest, bodyHtml: `<div style="font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">${html}</div>` })
}

/** A light box of label / value rows: invoice number, amount, due date… */
export function emailDetailsHtml(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F8FAFC" style="margin:4px 0 18px;background:#F8FAFC;border:1px solid ${LINE};border-radius:10px">${rows.map(([k, v], i) =>
    `<tr><td style="padding:11px 16px;${i ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:13px;color:${MUTED};width:40%">${escapeEmailHtml(k)}</td><td align="right" style="padding:11px 16px;${i ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:15px;font-weight:600;color:${INK};text-align:right">${escapeEmailHtml(v)}</td></tr>`).join('')}</table>`
}
