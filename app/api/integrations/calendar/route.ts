import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { createActivityCalendarEvent, logCalendarEventForDev } from '@/lib/integrations/calendar'

/**
 * POST /api/integrations/calendar
 * 
 * Create calendar event from activity
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw Object.assign(new Error('Invalid request payload'), { status: 400 })
    }

    const payload = body as {
      activity: {
        subject: string
        description?: string
        scheduledDate: string
        type: 'call' | 'meeting' | 'demo'
      }
      contactEmail: string
      userAccessToken?: string
    }

    if (!payload.activity || !payload.contactEmail) {
      throw Object.assign(new Error('Activity and contact email are required'), { status: 400 })
    }

    const isDev = process.env.NODE_ENV !== 'production'

    if (isDev || !payload.userAccessToken) {
      // Development mode or no token: Log only
      logCalendarEventForDev({
        summary: payload.activity.subject,
        description: payload.activity.description,
        start: {
          dateTime: new Date(payload.activity.scheduledDate).toISOString(),
          timeZone: 'Africa/Nairobi',
        },
        end: {
          dateTime: new Date(new Date(payload.activity.scheduledDate).getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: 'Africa/Nairobi',
        },
        attendees: [{ email: payload.contactEmail }],
        reminders: { useDefault: false },
      })

      return NextResponse.json({
        success: true,
        message: 'Calendar event logged (development mode)',
        mode: 'dev',
      })
    }

    // Production mode: Create actual event
    const result = await createActivityCalendarEvent(
      payload.activity,
      payload.contactEmail,
      payload.userAccessToken
    )

    if (!result.success) {
      return NextResponse.json({
        success: false,
        message: result.error || 'Failed to create calendar event',
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Calendar event created',
      eventId: result.eventId,
      eventLink: result.eventLink,
      createdBy: session.user.username,
    })
  })
}
