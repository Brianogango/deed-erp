'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { PortalPageSkeleton } from '@/components/ui'

interface Quote {
  id: string
  ref: string
  companyName: string
  contactPersonName: string
  issueDate: string
  validUntil: string
  subtotal: number
  taxTotal: number
  total: number
  status: string
  paymentTerms: string
  deliveryTerms?: string
  warranty?: string
  notes?: string
  ownerName: string
  lines: Array<{
    productName: string
    sku: string
    qty: number
    unitPrice: number
    discount: number
    taxRate: number
    lineTotal: number
  }>
}

function PortalLoading() {
  return <PortalPageSkeleton label="Loading quote…" />
}

export default function CustomerQuotePortal() {
  return (
    <Suspense fallback={<PortalLoading />}>
      <CustomerQuotePortalContent />
    </Suspense>
  )
}

function CustomerQuotePortalContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const quoteId = params.id as string
  const token = searchParams.get('token') ?? ''
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ''

  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [showRejectPrompt, setShowRejectPrompt] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchQuote()
  }, [quoteId, token])

  const fetchQuote = async () => {
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}${tokenQuery}`)
      if (!response.ok) {
        throw new Error('Quote not found')
      }
      const data = await response.json()
      setQuote(data.quote)
    } catch (err) {
      setError('Failed to load quote. Please check the link.')
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async () => {
    if (!quote) return

    setAccepting(true)
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/accept${tokenQuery}`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to accept quote')
      }

      setAccepted(true)
    } catch (err) {
      setError('Failed to accept quote. Please try again or contact us directly.')
    } finally {
      setAccepting(false)
    }
  }

  const handleReject = async () => {
    if (!quote) return
    setRejecting(true)
    try {
      const response = await fetch(`/api/portal/quotes/${quoteId}/reject${tokenQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      })
      if (!response.ok) {
        throw new Error('Failed to decline quote')
      }
      setRejected(true)
      setShowRejectPrompt(false)
    } catch (err) {
      setError('Failed to decline quote. Please try again or contact us directly.')
    } finally {
      setRejecting(false)
    }
  }

  const downloadPdf = () => {
    window.location.href = `/api/portal/quotes/${quoteId}/pdf${tokenQuery}`
  }

  if (loading) {
    return <PortalLoading />
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#090b12] to-[#1a1d2e] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#0c0e14] border border-red-500/30 rounded-lg p-8 text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-white mb-2">Quote Not Found</h1>
          <p className="text-[#98a2b3] mb-6">{error}</p>
          <p className="text-sm text-[#555A73]">
            If you believe this is an error, please contact us directly.
          </p>
        </div>
      </div>
    )
  }

  const money = (value: unknown) => `KES ${Number(value ?? 0).toLocaleString()}`
  const quoteLines = Array.isArray(quote.lines) ? quote.lines : []
  const isExpired = quote.validUntil ? new Date(quote.validUntil) < new Date() : false
  const isDecided = accepted || rejected || quote.status === 'accepted' || quote.status === 'rejected'
  const isRespondable = quote.status === 'sent' && !isExpired && !isDecided

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#090b12] to-[#1a1d2e] py-12 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-[#0c0e14] border border-white/10 rounded-lg p-8 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                {process.env.NEXT_PUBLIC_COMPANY_NAME || 'Deed Technologies'}
              </h1>
              <p className="text-[#98a2b3]">{process.env.NEXT_PUBLIC_COMPANY_ADDRESS || 'Westlands, Nairobi'}</p>
              <p className="text-[#98a2b3]">
                {process.env.NEXT_PUBLIC_COMPANY_PHONE || '+254 20 123 4567'} · {process.env.NEXT_PUBLIC_COMPANY_EMAIL || 'sales@deed.co.ke'}
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-[#98a2b3] mb-1">QUOTATION</div>
              <div className="text-2xl font-bold text-[#875BF7]">{quote.ref}</div>
              <div className="text-sm text-[#98a2b3] mt-2">
                <div>Date: {quote.issueDate}</div>
                <div>Valid Until: {quote.validUntil}</div>
              </div>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex gap-3">
            {quote.status === 'accepted' && (
              <div className="inline-block px-3 py-1 bg-green-500/20 border border-green-500/30 rounded text-green-400 text-sm">
                ✓ Accepted
              </div>
            )}
            {quote.status === 'rejected' && (
              <div className="inline-block px-3 py-1 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-sm">
                Declined
              </div>
            )}
            {isExpired && (
              <div className="inline-block px-3 py-1 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-sm">
                ⚠ Expired
              </div>
            )}
            {accepted && (
              <div className="inline-block px-3 py-1 bg-green-500/20 border border-green-500/30 rounded text-green-400 text-sm">
                ✓ Just Accepted - We'll contact you soon!
              </div>
            )}
            {rejected && (
              <div className="inline-block px-3 py-1 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-sm">
                Declined — thanks for letting us know
              </div>
            )}
          </div>
        </div>

        {/* Customer Info */}
        <div className="bg-[#0c0e14] border border-white/10 rounded-lg p-8 mb-6">
          <h2 className="text-lg font-bold text-white mb-4">Bill To</h2>
          <div className="text-[#98a2b3]">
            <div className="font-semibold text-white mb-1">{quote.companyName}</div>
            <div>Attention: {quote.contactPersonName}</div>
            <div className="mt-3 text-sm">
              <div>Sales Representative: {quote.ownerName}</div>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-[#0c0e14] border border-white/10 rounded-lg p-8 mb-6">
          <h2 className="text-lg font-bold text-white mb-4">Items</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 text-[#98a2b3] font-semibold text-sm">#</th>
                  <th className="text-left py-3 text-[#98a2b3] font-semibold text-sm">Description</th>
                  <th className="text-center py-3 text-[#98a2b3] font-semibold text-sm">Qty</th>
                  <th className="text-right py-3 text-[#98a2b3] font-semibold text-sm">Unit Price</th>
                  <th className="text-right py-3 text-[#98a2b3] font-semibold text-sm">Disc%</th>
                  <th className="text-right py-3 text-[#98a2b3] font-semibold text-sm">Total</th>
                </tr>
              </thead>
              <tbody>
                {quoteLines.map((line, idx) => (
                  <tr key={idx} className="border-b border-white/5">
                    <td className="py-3 text-[#98a2b3]">{idx + 1}</td>
                    <td className="py-3 text-white">
                      <div>{line.productName || 'Item'}</div>
                      <div className="text-xs text-[#555A73]">{line.sku}</div>
                    </td>
                    <td className="py-3 text-center text-white">{line.qty}</td>
                    <td className="py-3 text-right text-[#98a2b3]">
                      {money(line.unitPrice)}
                    </td>
                    <td className="py-3 text-right text-[#98a2b3]">{line.discount}%</td>
                    <td className="py-3 text-right text-white font-semibold">
                      {money(line.lineTotal)}
                    </td>
                  </tr>
                ))}
                {quoteLines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#98a2b3]">
                      No line items are attached to this quote.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-[#98a2b3]">
                  <span>Subtotal:</span>
                  <span>{money(quote.subtotal)}</span>
                </div>
                <div className="flex justify-between text-[#98a2b3]">
                  <span>Tax (VAT):</span>
                  <span>{money(quote.taxTotal)}</span>
                </div>
                <div className="flex justify-between text-xl font-bold text-[#875BF7] pt-2 border-t border-white/10">
                  <span>TOTAL:</span>
                  <span>{money(quote.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Terms */}
        <div className="bg-[#0c0e14] border border-white/10 rounded-lg p-8 mb-6">
          <h2 className="text-lg font-bold text-white mb-4">Terms & Conditions</h2>
          <div className="space-y-2 text-[#98a2b3]">
            <div><strong className="text-white">Payment Terms:</strong> {quote.paymentTerms}</div>
            {quote.deliveryTerms && (
              <div><strong className="text-white">Delivery Terms:</strong> {quote.deliveryTerms}</div>
            )}
            {quote.warranty && (
              <div><strong className="text-white">Warranty:</strong> {quote.warranty}</div>
            )}
            {quote.notes && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <strong className="text-white">Notes:</strong> {quote.notes}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            onClick={downloadPdf}
            className="flex-1 bg-[#1a1d2e] border border-white/10 text-white py-4 rounded-lg font-semibold hover:bg-[#252938] transition-colors"
          >
            📄 Download PDF
          </button>

          {isRespondable ? (
            <>
              <button
                onClick={handleAccept}
                disabled={accepting || rejecting}
                className="flex-1 bg-gradient-to-r from-[#875BF7] to-[#6941C6] text-white py-4 rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {accepting ? 'Accepting...' : '✓ Accept Quote'}
              </button>
              <button
                onClick={() => setShowRejectPrompt(true)}
                disabled={accepting || rejecting}
                className="flex-1 bg-transparent border border-red-500/40 text-red-400 py-4 rounded-lg font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                Decline
              </button>
            </>
          ) : quote.status === 'accepted' || accepted ? (
            <div className="flex-1 bg-green-500/20 border border-green-500/30 text-green-400 py-4 rounded-lg font-semibold text-center">
              ✓ Quote Accepted
            </div>
          ) : quote.status === 'rejected' || rejected ? (
            <div className="flex-1 bg-red-500/20 border border-red-500/30 text-red-400 py-4 rounded-lg font-semibold text-center">
              Quote Declined
            </div>
          ) : isExpired ? (
            <div className="flex-1 bg-red-500/20 border border-red-500/30 text-red-400 py-4 rounded-lg font-semibold text-center">
              Quote Expired - Contact Us
            </div>
          ) : null}
        </div>

        {showRejectPrompt && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-6 z-50" role="dialog" aria-modal="true">
            <div className="max-w-md w-full bg-[#0c0e14] border border-white/10 rounded-lg p-6">
              <h2 className="text-lg font-bold text-white mb-2">Decline this quote?</h2>
              <p className="text-sm text-[#98a2b3] mb-4">Let us know why (optional) so we can follow up appropriately.</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                rows={3}
                className="w-full bg-[#1a1d2e] border border-white/10 rounded-lg p-3 text-white text-sm mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRejectPrompt(false)}
                  disabled={rejecting}
                  className="flex-1 bg-transparent border border-white/10 text-white py-3 rounded-lg font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejecting}
                  className="flex-1 bg-red-500/20 border border-red-500/40 text-red-400 py-3 rounded-lg font-semibold hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {rejecting ? 'Declining...' : 'Confirm Decline'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Contact Info */}
        <div className="mt-8 text-center text-[#555A73] text-sm">
          <p>Questions? Contact {quote.ownerName}</p>
          <p className="mt-1">
            {process.env.NEXT_PUBLIC_COMPANY_EMAIL || 'sales@deed.co.ke'} · {process.env.NEXT_PUBLIC_COMPANY_PHONE || '+254 20 123 4567'}
          </p>
        </div>
      </div>
    </div>
  )
}
