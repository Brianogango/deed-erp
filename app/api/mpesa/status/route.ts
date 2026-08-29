import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { mpesaPublicStatus } from '@/lib/mpesa/config'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    return NextResponse.json(mpesaPublicStatus())
  })
}
