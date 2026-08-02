import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import { bucketOpenInvoices } from '@/lib/accounting/ageing'
import { generatePortalDocToken, portalDocUrl } from '@/lib/portal-document-token'
import { sendMultiChannelMessage, type MessageChannel } from '@/lib/integrations/messaging'

export const dynamic = 'force-dynamic'

type BlobInvoice = {
  id: string
  ref: string
  partnerId?: string
  partnerName: string
  type?: string
  status?: string
  date: string
  dueDate?: string
  total: number
  amountPaid: number
}

type BlobContact = {
  id: string
  name?: string
  email?: string
  phone?: string
}

/**
 * POST /api/finance/payment-reminders
 * Send overdue AR reminders (email / WhatsApp / SMS) for aged receivables.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const body = await request.json().catch(() => ({})) as {
      asOf?: string
      minBucket?: 'd30' | 'd60' | 'd90' | 'over90'
      channels?: Array<'email' | 'whatsapp' | 'sms'>
      partnerId?: string
      dryRun?: boolean
    }

    const minBucket = body.minBucket || 'd30'
    const rank = { current: 0, d30: 1, d60: 2, d90: 3, over90: 4 } as const
    const minRank = rank[minBucket]
    const channels: MessageChannel[] = body.channels?.length
      ? body.channels.filter((c): c is MessageChannel => c === 'email' || c === 'whatsapp' || c === 'sms')
      : ['email']
    const asOf = body.asOf || new Date().toISOString().slice(0, 10)

    const state = await loadAppState()
    const invoices = ((state['deed_invoices'] ?? []) as BlobInvoice[])
      .filter(i => (i.type || 'customer_invoice') === 'customer_invoice')
    const contacts = (state['deed_contacts'] ?? []) as BlobContact[]
    const report = bucketOpenInvoices(invoices, asOf)
    const candidates = report.rows.filter(r => {
      if (rank[r.bucket] < minRank) return false
      if (body.partnerId && (r.partnerId || r.partnerName) !== body.partnerId) return false
      return true
    })

    const company = process.env.PDF_COMPANY_NAME || 'Deed Technologies'
    const results: Array<{ invoiceId: string; ref: string; to?: string; ok: boolean; skipped?: string; error?: string }> = []

    for (const row of candidates) {
      const contact = contacts.find(c => c.id === row.partnerId)
      const email = contact?.email
      const phone = contact?.phone
      if (!email && !phone) {
        results.push({ invoiceId: row.id, ref: row.ref, ok: false, skipped: 'No email/phone on contact' })
        continue
      }
      const token = generatePortalDocToken('invoice', row.id)
      const url = portalDocUrl('invoice', row.id, token)
      const message =
        `Hi ${row.partnerName},\n\n` +
        `This is a friendly reminder that invoice ${row.ref} for KES ${Math.round(row.balance).toLocaleString('en-KE')} ` +
        `is ${row.daysPastDue} day(s) past due (due ${row.dueDate}).\n\n` +
        `View invoice: ${url}\n\n` +
        `Thank you,\n${company}`

      if (body.dryRun) {
        results.push({ invoiceId: row.id, ref: row.ref, to: email || phone, ok: true, skipped: 'dryRun' })
        continue
      }

      try {
        await sendMultiChannelMessage({
          purpose: 'general',
          recipient: { name: row.partnerName, email, phone },
          channels,
          mailbox: 'accounts',
          content: {
            subject: `Payment reminder — ${row.ref}`,
            text: message,
            smsText: `Reminder: ${row.ref} balance KES ${Math.round(row.balance).toLocaleString('en-KE')} is overdue. ${url} — ${company}`,
            whatsappText: message,
            html: `<p>${message.replace(/\n/g, '<br/>')}</p>`,
          },
          metadata: { type: 'payment_reminder', invoiceId: row.id, invoiceRef: row.ref },
        })
        results.push({ invoiceId: row.id, ref: row.ref, to: email || phone, ok: true })
      } catch (err) {
        results.push({
          invoiceId: row.id,
          ref: row.ref,
          to: email || phone,
          ok: false,
          error: err instanceof Error ? err.message : 'Send failed',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      asOf,
      minBucket,
      candidateCount: candidates.length,
      sent: results.filter(r => r.ok && r.skipped !== 'dryRun').length,
      results,
    })
  })
}
