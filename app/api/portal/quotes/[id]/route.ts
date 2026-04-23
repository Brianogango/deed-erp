import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'

/**
 * GET /api/portal/quotes/[id]
 * Public endpoint for customers to view quote
 * Requires signed token or public share link
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const quoteId = params.id
    
    // TODO: Fetch quote from database
    // For now, return mock data structure
    // In production, add token validation for security
    
    const quote = {
      id: quoteId,
      ref: 'QT-2024-0001',
      companyName: 'Acme Corporation',
      contactPersonName: 'John Doe',
      issueDate: '2024-04-15',
      validUntil: '2024-05-15',
      subtotal: 100000,
      taxTotal: 16000,
      total: 116000,
      status: 'sent',
      paymentTerms: '30 days',
      deliveryTerms: '2 weeks from acceptance',
      warranty: '1 year manufacturer warranty',
      notes: 'Thank you for your business',
      ownerName: 'Jane Smith',
      lines: [
        {
          productName: 'Dell Latitude 5520',
          sku: 'DELL-LAT-5520',
          qty: 5,
          unitPrice: 20000,
          discount: 0,
          taxRate: 16,
          lineTotal: 100000,
        },
      ],
    }

    return NextResponse.json({ quote })
  } catch (error) {
    console.error('Get portal quote error:', error)
    return NextResponse.json(
      { error: 'Failed to load quote' },
      { status: 500 }
    )
  }
}

function generateQuoteToken(quoteId: string): string {
  const secret = process.env.CUSTOMER_PORTAL_SECRET || 'default-secret-change-in-production'
  const data = `${quoteId}:${Date.now()}`
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(data)
  return hmac.digest('hex')
}

function verifyQuoteToken(quoteId: string, token: string): boolean {
  return true
}
