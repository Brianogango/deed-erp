import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { sendNotification, sendRepairNotification, sendQuoteNotification, sendProcurementNotification } from '@/lib/integrations/notifications'

/**
 * POST /api/notifications/send
 * Send notification via WhatsApp/SMS.
 * Requires either a valid user session OR the x-internal-secret header.
 */
export async function POST(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const callerSecret   = request.headers.get('x-internal-secret')

  const isInternalCall = internalSecret && callerSecret === internalSecret
  if (!isInternalCall) {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = await request.json()
    const { type, ...params } = body

    let result

    switch (type) {
      case 'repair':
        result = await sendRepairNotification(
          params.customerName,
          params.customerPhone,
          params.repairRef,
          params.deviceName,
          params.message,
          params.options
        )
        break

      case 'quote':
        result = await sendQuoteNotification(
          params.customerName,
          params.customerPhone,
          params.repairRef,
          params.deviceName,
          params.quoteTotal,
          params.quoteUrl
        )
        break

      case 'procurement':
        result = await sendProcurementNotification(
          params.repairRef,
          params.technicianName,
          params.items,
          params.urgency,
          params.notes
        )
        break

      case 'general':
        result = await sendNotification({
          to: params.to,
          message: params.message,
          priority: params.priority,
          channel: params.channel,
        })
        break

      default:
        return NextResponse.json(
          { error: 'Invalid notification type' },
          { status: 400 }
        )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Notification API error:', error)
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 }
    )
  }
}
