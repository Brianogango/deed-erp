import type { CompanySettings } from '@/lib/store'
import { downloadCommercialPdf } from '@/lib/commercial-pdf'
import type { AgentCommission, AgentPayout } from '@/lib/agents/agent-commissions'

const METHOD: Record<AgentPayout['method'], string> = { mpesa: 'M-Pesa', bank: 'Bank transfer', cash: 'Cash' }

/**
 * A payout's statement for the agent: each sale it paid (refund recoveries
 * as deductions), withholding tax kept for KRA, and what was sent, with a
 * place for the agent to sign for it.
 */
export async function downloadAgentPayoutStatement(opts: {
  payout: AgentPayout
  commissions: AgentCommission[]
  agent?: { phone?: string | null; email?: string | null; kraPin?: string | null }
  company: CompanySettings
}) {
  const { payout } = opts
  const paid = opts.commissions.filter(c => payout.commissionIds.includes(c.id))
  const lines = paid.map(c => ({
    description: [
      c.amount < 0 ? `Refund recovery — ${c.sourceRef}` : `Commission — ${c.sourceRef}`,
      c.customerName ? ` · ${c.customerName}` : '',
      c.saleTotal ? ` · sale KSh ${c.saleTotal.toLocaleString('en-KE')}` : '',
      c.description ? ` · ${c.description}` : '',
    ].join(''),
    qty: 1,
    unitPrice: c.amount,
    taxRate: 0,
    subtotal: c.amount,
  }))
  if (payout.withholdingTax > 0) {
    lines.push({ description: 'Withholding tax kept for KRA', qty: 1, unitPrice: -payout.withholdingTax, taxRate: 0, subtotal: -payout.withholdingTax })
  }
  const how = `${METHOD[payout.method]}${payout.reference ? ` ${payout.reference}` : ''}${payout.paidFrom ? ` from ${payout.paidFrom}` : ''}`
  await downloadCommercialPdf({
    title: 'Commission Payout',
    ref: payout.ref,
    date: payout.paidAt,
    partyLabel: 'Paid to',
    customerName: payout.agentName,
    customerPhone: opts.agent?.phone || undefined,
    customerEmail: opts.agent?.email || undefined,
    customerTaxId: opts.agent?.kraPin || undefined,
    lines,
    subtotal: payout.net,
    taxTotal: 0,
    total: payout.net,
    amountPaid: payout.net,
    notes: [
      payout.withholdingTax > 0
        ? `Commission KSh ${payout.gross.toLocaleString('en-KE')} less withholding tax KSh ${payout.withholdingTax.toLocaleString('en-KE')} (paid to KRA for the agent).`
        : '',
      `KSh ${payout.net.toLocaleString('en-KE')} paid by ${how} on ${payout.paidAt}.`,
      payout.paidBy ? `Recorded by ${payout.paidBy.replace(/\.+$/, '')}.` : '',
    ].filter(Boolean).join(' '),
    showPaymentDetails: false,
    showReceiptAcknowledgement: true,
  }, opts.company, [], `Commission Payout - ${payout.ref}.pdf`)
}
