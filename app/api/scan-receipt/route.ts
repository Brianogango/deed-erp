import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getRequiredSession } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = [
  'courier', 'office_supplies', 'water', 'printing',
  'transport', 'meals', 'utilities', 'software',
  'hardware', 'maintenance', 'other',
]

export async function POST(request: Request) {
  try {
    await getRequiredSession()

    const { imageBase64, mimeType } = await request.json()

    if (!imageBase64 || !mimeType) {
      return NextResponse.json({ error: 'imageBase64 and mimeType are required' }, { status: 400 })
    }

    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) {
      return NextResponse.json({ error: 'Only JPG, PNG, GIF, and WebP receipts can be scanned' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey === 'your-anthropic-api-key-here') {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
    }

    const client = new Anthropic({ apiKey })

    const today = new Date().toISOString().slice(0, 10)

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `Extract expense details from this receipt image or transaction screenshot. Today is ${today}.

Return ONLY a valid JSON object with these exact keys:
- "amount": number (total amount, no currency symbols, e.g. 2450)
- "date": string (YYYY-MM-DD format, use today ${today} if not visible)
- "description": string (merchant name + brief description, max 80 chars)
- "category": string (must be exactly one of: courier, office_supplies, water, printing, transport, meals, utilities, software, hardware, maintenance, other)

Example: {"amount":1250,"date":"2026-05-01","description":"Artcaffe Karen - team lunch","category":"meals"}

Return ONLY the JSON object, nothing else.`,
            },
          ],
        },
      ],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    // Parse and validate the JSON
    let parsed: { amount?: number | string; date?: string; description?: string; category?: string }
    try {
      // Strip markdown code fences if present
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Could not parse receipt data' }, { status: 422 })
    }

    const parsedAmount = typeof parsed.amount === 'number'
      ? parsed.amount
      : Number(String(parsed.amount ?? '').replace(/[^\d.]/g, ''))
    const amount   = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null
    const date     = typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today
    const desc     = typeof parsed.description === 'string' ? parsed.description.slice(0, 80) : ''
    const category = VALID_CATEGORIES.includes(parsed.category ?? '') ? parsed.category : 'other'

    return NextResponse.json({ amount, date, description: desc, category })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Scan failed'
    const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
