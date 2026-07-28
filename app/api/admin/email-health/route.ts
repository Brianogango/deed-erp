import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { verifyEmailProvider } from '@/lib/integrations/email'

export async function GET(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const internal = Boolean(
    internalSecret && request.headers.get('x-internal-secret') === internalSecret,
  )
  if (!internal) {
    const session = await getServerSession()
    if (!session || session.user.role !== 'director') {
      return NextResponse.json({ error: 'Forbidden' }, { status: session ? 403 : 401 })
    }
  }

  const result = await verifyEmailProvider()
  return NextResponse.json({
    configured: result.success,
    provider: result.provider,
    mode: process.env.NODE_ENV ?? 'development',
    nonProductionSendingEnabled: process.env.EMAIL_SEND_IN_NON_PRODUCTION === 'true',
    error: result.error,
  }, { status: result.success ? 200 : 503 })
}
