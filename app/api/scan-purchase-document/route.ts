import { handleImageScan } from '@/lib/scan/scan-route.server'
import { readPurchaseDocument } from '@/lib/scan/purchase-extract.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleImageScan(request, 'Purchase document image', readPurchaseDocument,
    result => (result.lines.length ? null : 'No purchase line items could be read from this document'))
}
