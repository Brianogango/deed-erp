import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'

async function checkDb() {
  const started = Date.now()
  await sql`SELECT 1`
  return { ok: true, latencyMs: Date.now() - started }
}

async function appStateSummary() {
  const { rows } = await sql`
    SELECT COUNT(*)::int as key_count,
           COALESCE(SUM(length(value)), 0)::int as bytes
    FROM app_state
  `
  return rows[0] ?? { key_count: 0, bytes: 0 }
}

export async function GET(request: NextRequest) {
  const started = Date.now()
  const detailed = process.env.INTERNAL_API_SECRET &&
    request.headers.get('x-internal-secret') === process.env.INTERNAL_API_SECRET

  try {
    const db = await checkDb()
    const body: Record<string, unknown> = {
      ok: true,
      status: 'ok',
      service: 'deed-erp',
      db,
      uptimeSec: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    }

    if (detailed) {
      body.appState = await appStateSummary()
      body.node = process.version
      body.env = process.env.NODE_ENV ?? 'unknown'
    }

    return NextResponse.json(body, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: 'error',
      service: 'deed-erp',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      error: detailed && error instanceof Error ? error.message : 'Health check failed',
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
