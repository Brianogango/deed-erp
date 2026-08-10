/**
 * Automation #2: after a customer invoice payment is recorded, notify the
 * customer (email required; WhatsApp/SMS when a phone exists).
 *
 * Never throws into the payment transaction path — callers must catch.
 */
import 'server-only'
import prisma from '@/lib/prisma'
import { sendMultiChannelMessage } from '@/lib/integrations/messaging'
import {
  appendDocumentEmailSend,
  listDocumentEmailSends,
} from '@/lib/document-email-sends'

export type PaymentReceiptNotifyInput = {
  invoiceId: string
  paymentId: string
  amount: number
  paymentMethod?: string | null
  reference?: string | null
  paidAt?: Date | string | null
  actorUserId?: string | null
  actorName?: string | null
}

function formatKes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString('en-KE')}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildPaymentReceiptContent(input: {
  customerName: string
  invoiceRef: string
  amount: number
  paymentMethod?: string | null
  reference?: string | null
  paidAtLabel: string
  totalAmount: number
  amountPaid: number
  balance: number
}): { subject: string; html: string; text: string; whatsappText: string; smsText: string } {
  const paidInFull = input.balance <= 0.009
  const subject = paidInFull
    ? `Payment received — ${input.invoiceRef} paid in full`
    : `Payment received — ${input.invoiceRef}`

  const methodBit = input.paymentMethod ? ` via ${input.paymentMethod}` : ''
  const refBit = input.reference ? ` (ref ${input.reference})` : ''

  const textLines = [
    `Hello ${input.customerName},`,
    '',
    `We received your payment of ${formatKes(input.amount)}${methodBit}${refBit} for invoice ${input.invoiceRef}.`,
    `Date: ${input.paidAtLabel}`,
    `Invoice total: ${formatKes(input.totalAmount)}`,
    `Amount paid to date: ${formatKes(input.amountPaid)}`,
    paidInFull ? 'Status: Paid in full. Thank you.' : `Balance remaining: ${formatKes(input.balance)}`,
    '',
    'Deed Technologies',
    process.env.ACCOUNTS_EMAIL || 'accounts@deed.co.ke',
  ]

  const html = [
    `<p>Hello ${escapeHtml(input.customerName)},</p>`,
    `<p>We received your payment of <strong>${escapeHtml(formatKes(input.amount))}</strong>${escapeHtml(methodBit)}${escapeHtml(refBit)} for invoice <strong>${escapeHtml(input.invoiceRef)}</strong>.</p>`,
    `<p>Date: ${escapeHtml(input.paidAtLabel)}</p>`,
    `<p>Invoice total: ${escapeHtml(formatKes(input.totalAmount))}<br/>`,
    `Amount paid to date: ${escapeHtml(formatKes(input.amountPaid))}<br/>`,
    paidInFull
      ? 'Status: <strong>Paid in full</strong>. Thank you.</p>'
      : `Balance remaining: <strong>${escapeHtml(formatKes(input.balance))}</strong></p>`,
    `<p>Deed Technologies<br/>${escapeHtml(process.env.ACCOUNTS_EMAIL || 'accounts@deed.co.ke')}</p>`,
  ].join('\n')

  const short = paidInFull
    ? `Deed: payment of ${formatKes(input.amount)} received for ${input.invoiceRef}. Invoice is paid in full. Thank you.`
    : `Deed: payment of ${formatKes(input.amount)} received for ${input.invoiceRef}. Balance ${formatKes(input.balance)}.`

  return {
    subject,
    html,
    text: textLines.join('\n'),
    whatsappText: short,
    smsText: short.slice(0, 160),
  }
}

export function paymentReceiptAlreadySent(
  sends: Array<{ documentType: string; documentId: string; status: string; subject?: string; documentRef?: string }>,
  paymentId: string,
  invoiceRef?: string,
): boolean {
  return sends.some(
    s =>
      s.documentType === 'payment_receipt'
      && s.documentId === paymentId
      && s.status === 'success'
      && (!invoiceRef || !s.documentRef || s.documentRef === invoiceRef),
  )
}

/**
 * Best-effort customer notify after a new (non-idempotent) payment.
 * Idempotent retries must skip this — payment API returns early with idempotent:true.
 */
export async function notifyCustomerPaymentReceived(
  input: PaymentReceiptNotifyInput,
): Promise<{ sent: boolean; skipped?: string; error?: string }> {
  const prior = await listDocumentEmailSends({
    documentId: input.paymentId,
    documentType: 'payment_receipt',
    limit: 20,
  })
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { client: true },
  })
  if (!invoice) return { sent: false, skipped: 'invoice_missing' }
  if (!invoice.client) return { sent: false, skipped: 'client_missing' }

  if (paymentReceiptAlreadySent(prior, input.paymentId, invoice.invoiceNumber)) {
    return { sent: false, skipped: 'already_sent' }
  }

  const email = String(invoice.client.email || '').trim()
  const phone = String(invoice.client.phone || invoice.client.phoneAlt || '').trim()
  if (!email && !phone) return { sent: false, skipped: 'no_contact' }

  const totalAmount = Number(invoice.totalAmount) || 0
  const amountPaid = Number(invoice.amountPaid) || 0
  const balance = Math.max(0, totalAmount - amountPaid)
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date()
  const paidAtLabel = Number.isNaN(paidAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : paidAt.toISOString().slice(0, 10)

  const customerName =
    invoice.client.name || invoice.client.companyName || 'Customer'

  const content = buildPaymentReceiptContent({
    customerName,
    invoiceRef: invoice.invoiceNumber,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    paidAtLabel,
    totalAmount,
    amountPaid,
    balance,
  })

  const channels: Array<'email' | 'whatsapp' | 'sms'> = []
  if (email) channels.push('email')
  if (phone) channels.push('whatsapp')

  try {
    const result = await sendMultiChannelMessage({
      purpose: 'payment_receipt',
      recipient: {
        name: customerName,
        email: email || null,
        phone: phone || null,
      },
      channels: channels.length ? channels : ['email'],
      mailbox: 'accounts',
      replyTo: process.env.ACCOUNTS_EMAIL || undefined,
      content: {
        subject: content.subject,
        html: content.html,
        text: content.text,
        whatsappText: content.whatsappText,
        smsText: content.smsText,
      },
      metadata: {
        invoiceId: input.invoiceId,
        paymentId: input.paymentId,
        invoiceRef: invoice.invoiceNumber,
      },
    })

    const emailResult = result.results.email
    const waResult = result.results.whatsapp
    const anyOk = Object.values(result.results).some(r => r.success)

    if (email) {
      await appendDocumentEmailSend({
        documentType: 'payment_receipt',
        documentId: input.paymentId,
        documentRef: invoice.invoiceNumber,
        to: email,
        subject: content.subject,
        status: emailResult?.success ? 'success' : 'failed',
        error: emailResult?.success ? undefined : (emailResult?.error || 'email_failed'),
        messageId: emailResult?.messageId,
        channel: 'email',
        kind: 'initial',
        sentById: input.actorUserId || undefined,
        sentByName: input.actorName || undefined,
      })
    } else if (waResult) {
      await appendDocumentEmailSend({
        documentType: 'payment_receipt',
        documentId: input.paymentId,
        documentRef: invoice.invoiceNumber,
        to: phone,
        subject: content.subject,
        status: waResult.success ? 'success' : 'failed',
        error: waResult.success ? undefined : (waResult.error || 'whatsapp_failed'),
        messageId: waResult.messageId,
        channel: 'whatsapp',
        kind: 'initial',
        sentById: input.actorUserId || undefined,
        sentByName: input.actorName || undefined,
      })
    }

    if (!anyOk) {
      return { sent: false, error: 'all_channels_failed' }
    }
    return { sent: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'notify_failed'
    console.error('[payment-receipt-notify] failed', {
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      error: message,
    })
    try {
      await appendDocumentEmailSend({
        documentType: 'payment_receipt',
        documentId: input.paymentId,
        documentRef: invoice.invoiceNumber,
        to: email || phone || 'unknown',
        subject: content.subject,
        status: 'failed',
        error: message,
        channel: email ? 'email' : 'whatsapp',
        kind: 'initial',
        sentById: input.actorUserId || undefined,
        sentByName: input.actorName || undefined,
      })
    } catch {
      /* ignore log failure */
    }
    return { sent: false, error: message }
  }
}
