import { readFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { PUBLIC_API_CORS_HEADERS } from '@/lib/partner-api'

export const dynamic = 'force-dynamic'

/** Public download of the Partner API integration guide (Markdown). No API key required. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const inline = url.searchParams.get('inline') === '1'

  let body: string
  try {
    body = await readFile(path.join(process.cwd(), 'docs', 'PARTNER_API.md'), 'utf8')
  } catch {
    return NextResponse.json(
      { error: 'Partner API guide is not available on this server.' },
      { status: 404, headers: PUBLIC_API_CORS_HEADERS },
    )
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      ...PUBLIC_API_CORS_HEADERS,
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': inline
        ? 'inline; filename="Deed-Partner-API-Guide.md"'
        : 'attachment; filename="Deed-Partner-API-Guide.md"',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
