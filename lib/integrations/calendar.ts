// ─── Google Calendar Integration ──────────────────────────────────────────────

/**
 * Google Calendar Integration
 * 
 * Setup:
 * 1. Create project in Google Cloud Console
 * 2. Enable Google Calendar API
 * 3. Create OAuth 2.0 credentials
 * 4. Set environment variables:
 *    - GOOGLE_CLIENT_ID
 *    - GOOGLE_CLIENT_SECRET
 *    - GOOGLE_REDIRECT_URI
 * 
 * npm install googleapis
 * 
 * Docs: https://developers.google.com/calendar/api/v3/reference
 */

export interface CalendarEvent {
  summary: string
  description?: string
  start: {
    dateTime: string  // ISO 8601 format
    timeZone?: string
  }
  end: {
    dateTime: string
    timeZone?: string
  }
  attendees?: Array<{
    email: string
    displayName?: string
  }>
  reminders?: {
    useDefault: boolean
    overrides?: Array<{
      method: 'email' | 'popup'
      minutes: number
    }>
  }
  location?: string
  conferenceData?: {
    createRequest: {
      requestId: string
      conferenceSolutionKey: {
        type: 'hangoutsMeet'
      }
    }
  }
}

export interface CalendarResult {
  success: boolean
  eventId?: string
  eventLink?: string
  error?: string
}

/**
 * Create calendar event
 */
export const createCalendarEvent = async (
  event: CalendarEvent,
  accessToken: string
): Promise<CalendarResult> => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return {
      success: false,
      error: 'Google Calendar not configured',
    }
  }

  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error?.message || 'Calendar API error',
      }
    }

    return {
      success: true,
      eventId: data.id,
      eventLink: data.htmlLink,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create event from opportunity activity
 */
export const createActivityCalendarEvent = async (
  activity: {
    subject: string
    description?: string
    scheduledDate: string
    type: 'call' | 'meeting' | 'demo'
  },
  contactEmail: string,
  userAccessToken: string
): Promise<CalendarResult> => {
  const startTime = new Date(activity.scheduledDate)
  
  // Default durations by type
  const duration = {
    call: 30,      // 30 minutes
    meeting: 60,   // 1 hour
    demo: 90,      // 1.5 hours
  }[activity.type]

  const endTime = new Date(startTime.getTime() + duration * 60 * 1000)

  const event: CalendarEvent = {
    summary: activity.subject,
    description: activity.description,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: 'Africa/Nairobi',
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: 'Africa/Nairobi',
    },
    attendees: [
      { email: contactEmail },
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },    // 1 hour before
        { method: 'popup', minutes: 15 },    // 15 minutes before
      ],
    },
  }

  // Add Google Meet link for meetings/demos
  if (activity.type === 'meeting' || activity.type === 'demo') {
    event.conferenceData = {
      createRequest: {
        requestId: `opp-${Date.now()}`,
        conferenceSolutionKey: {
          type: 'hangoutsMeet',
        },
      },
    }
  }

  return createCalendarEvent(event, userAccessToken)
}

/**
 * Get OAuth authorization URL
 */
export const getGoogleAuthUrl = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  
  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' ')

  return `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `access_type=offline&` +
    `prompt=consent`
}

/**
 * Exchange authorization code for access token
 */
export const exchangeGoogleAuthCode = async (code: string) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error_description || 'Failed to exchange auth code')
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

/**
 * Development Mode: Log calendar event
 */
export const logCalendarEventForDev = (event: CalendarEvent) => {
  if (process.env.NODE_ENV === 'production') return
  console.log('═══ CALENDAR EVENT (Development Mode) ═══')
  console.log('Summary:', event.summary)
  console.log('Start:', event.start.dateTime)
  console.log('End:', event.end.dateTime)
  if (event.attendees) {
    console.log('Attendees:', event.attendees.map(a => a.email).join(', '))
  }
  if (event.location) console.log('Location:', event.location)
  console.log('══════════════════════════════════════════')
}
