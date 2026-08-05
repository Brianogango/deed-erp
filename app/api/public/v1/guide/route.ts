import { readFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { partnerCorsHeaders } from '@/lib/partner-api'

export const dynamic = 'force-dynamic'

/** Public download of the Partner API integration guide (Markdown). No API key required. */
export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: partnerCorsHeaders(request) })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const inline = url.searchParams.get('inline') === '1'
  const cors = partnerCorsHeaders(request)

  let body: string
  try {
    body = await readFile(path.join(process.cwd(), 'docs', 'PARTNER_API.md'), 'utf8')
  } catch {
    return NextResponse.json(
      { error: 'Partner API guide is not available on this server.' },
      { status: 404, headers: cors },
    )
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': inline
        ? 'inline; filename="Deed-Partner-API-Guide.md"'
        : 'attachment; filename="Deed-Partner-API-Guide.md"',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
