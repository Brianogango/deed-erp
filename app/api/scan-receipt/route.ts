import { handleImageScan } from '@/lib/scan/scan-route.server'
import { readReceiptImage } from '@/lib/scan/receipt-extract.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleImageScan(request, 'Receipt image', readReceiptImage)
}
