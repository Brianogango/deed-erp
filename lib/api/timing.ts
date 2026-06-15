import { NextResponse } from 'next/server'

export async function withTiming<T extends NextResponse>(
  label: string,
  handler: () => Promise<T>,
): Promise<T> {
  const started = Date.now()
  try {
    return await handler()
  } finally {
    const elapsed = Date.now() - started
    const threshold = Number(process.env.SLOW_API_MS ?? 500)
    if (elapsed > threshold) {
      console.warn('[slow-api]', JSON.stringify({ label, elapsedMs: elapsed }))
    }
  }
}
