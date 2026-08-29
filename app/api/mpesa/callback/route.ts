import { NextResponse } from 'next/server'
import { applyStkCallback } from '@/lib/mpesa/service'

/** Safaricom posts here after the customer accepts or declines the STK prompt. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  try {
    await applyStkCallback(body)
  } catch (error) {
    console.error('[mpesa-callback]', error)
  }
  // Always 200 so Daraja does not retry forever on our processing errors.
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
}
