/**
 * Outbound alerts when sales@ IMAP creates a CRM lead.
 * In-app bell already fires in processSalesInboxLeads; this adds email so
 * reps see inbound RFQs even when the ERP tab is closed.
 */
import 'server-only'
type InboundLeadNotifyInput = {
  leadId: string
  leadName: string
  leadEmail?: string | null
  companyName?: string | null
  subject?: string | null
  snippet?: string | null
  ownerId?: string | null
  ownerEmail?: string | null
  ownerName?: string | null
  attachmentCount?: number
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  return email
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function resolveInboundLeadNotifyRecipients(input: {
  ownerEmail?: string | null
  salesTeamEmail?: string | null
}): { to: string; cc?: string } | null {
  const owner = normalizeEmail(input.ownerEmail)
  const team = normalizeEmail(input.salesTeamEmail)
  if (owner && team && owner !== team) return { to: owner, cc: team }
  if (owner) return { to: owner }
  if (team) return { to: team }
  return null
}

export function buildInboundLeadNotifyContent(input: InboundLeadNotifyInput): {
  subject: string
  html: string
  text: string
} {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  const leadPath = `${appUrl}/crm?tab=leads`
  const subjectBit = input.subject ? ` — ${input.subject}` : ''
  const subject = `New sales@ lead: ${input.leadName}${subjectBit}`.slice(0, 180)

  const lines = [
    `Lead: ${input.leadName}`,
    input.companyName ? `Company: ${input.companyName}` : null,
    input.leadEmail ? `Email: ${input.leadEmail}` : null,
    input.subject ? `Subject: ${input.subject}` : null,
    input.ownerName ? `Assigned to: ${input.ownerName}` : null,
    input.attachmentCount ? `Attachments: ${input.attachmentCount}` : null,
    '',
    input.snippet ? input.snippet.slice(0, 500) : null,
    '',
    `Open in CRM: ${leadPath}`,
  ].filter(v => v != null) as string[]

  const html = [
    '<p><strong>New inbound sales lead</strong> (sales@ → CRM)</p>',
    `<p><strong>${escapeHtml(input.leadName)}</strong></p>`,
    input.companyName ? `<p>Company: ${escapeHtml(input.companyName)}</p>` : '',
    input.leadEmail ? `<p>Email: <a href="mailto:${escapeHtml(input.leadEmail)}">${escapeHtml(input.leadEmail)}</a></p>` : '',
    input.subject ? `<p>Subject: ${escapeHtml(input.subject)}</p>` : '',
    input.ownerName ? `<p>Assigned to: ${escapeHtml(input.ownerName)}</p>` : '',
    input.attachmentCount ? `<p>Attachments: ${input.attachmentCount}</p>` : '',
    input.snippet ? `<p>${escapeHtml(input.snippet.slice(0, 500))}</p>` : '',
    `<p><a href="${escapeHtml(leadPath)}">Open in CRM</a></p>`,
  ].filter(Boolean).join('\n')

  return { subject, html, text: lines.join('\n') }
}
