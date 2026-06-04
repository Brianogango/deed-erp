import { NextResponse } from 'next/server'
import { recognize } from 'tesseract.js'
import { getRequiredSession } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_CATEGORIES = [
  'courier', 'office_supplies', 'water', 'printing',
  'transport', 'meals', 'utilities', 'software',
  'hardware', 'maintenance', 'other',
] as const

type ExpenseCategory = typeof VALID_CATEGORIES[number]

type ReceiptScanResult = {
  amount: number | null
  date: string
  description: string
  category: ExpenseCategory
  rawText: string
  confidence: number | null
  engine: 'deed-local-ocr'
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function cleanLine(line: string) {
  return line.replace(/\s+/g, ' ').replace(/[|_~`]+/g, '').trim()
}

function normaliseText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
}

function parseAmountToken(token: string) {
  const cleaned = token.replace(/[^\d.,]/g, '')
  if (!cleaned) return null

  const normalised = cleaned.includes(',') && cleaned.includes('.')
    ? cleaned.replace(/,/g, '')
    : cleaned.replace(/,/g, '')

  const value = Number(normalised)
  return Number.isFinite(value) && value > 0 ? value : null
}

function extractAmounts(line: string) {
  const matches = line.match(/(?:ksh|kes|usd|eur|gbp|amount|total|paid|balance)?\s*[:=-]?\s*(\d{1,3}(?:[, ]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi) ?? []
  return matches
    .map(parseAmountToken)
    .filter((amount): amount is number => amount !== null && amount < 10_000_000)
}

function extractAmount(lines: string[]) {
  const preferredKeywords = /\b(grand total|total due|amount due|amount paid|total paid|total|paid)\b/i
  const ignoredKeywords = /\b(subtotal|sub total|vat|tax|change|balance|cashier|till|mpesa|m-pesa|phone|invoice|receipt|date|time)\b/i

  const preferred = lines
    .filter(line => preferredKeywords.test(line) && !ignoredKeywords.test(line.replace(/\b(total|paid)\b/gi, '')))
    .flatMap(extractAmounts)

  if (preferred.length > 0) return Math.max(...preferred)

  const currencyLines = lines.filter(line => /\b(ksh|kes|amount|total|paid)\b/i.test(line))
  const currencyAmounts = currencyLines.flatMap(extractAmounts)
  if (currencyAmounts.length > 0) return Math.max(...currencyAmounts)

  const allAmounts = lines.flatMap(extractAmounts).filter(amount => amount >= 10)
  return allAmounts.length > 0 ? Math.max(...allAmounts) : null
}

function toIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function extractDate(text: string, today: string) {
  const numeric = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/)
  if (numeric) {
    if (numeric[1]) {
      const iso = toIsoDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]))
      if (iso) return iso
    } else {
      const first = Number(numeric[4])
      const second = Number(numeric[5])
      const year = Number(numeric[6])
      const day = first > 12 ? first : second > 12 ? second : first
      const month = first > 12 ? second : second > 12 ? first : second
      const iso = toIsoDate(year, month, day)
      if (iso) return iso
    }
  }

  const monthLookup: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  }

  const named = text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i)
  if (named) {
    const iso = toIsoDate(Number(named[3]), monthLookup[named[2].toLowerCase()] ?? 0, Number(named[1]))
    if (iso) return iso
  }

  return today
}

function classifyCategory(text: string): ExpenseCategory {
  const lower = text.toLowerCase()
  const rules: Array<[ExpenseCategory, RegExp]> = [
    ['meals', /\b(cafe|coffee|restaurant|hotel|kitchen|food|meal|lunch|dinner|breakfast|pizza|chicken|java|artcaffe|kfc|quickmart food)\b/],
    ['transport', /\b(fuel|petrol|diesel|uber|bolt|taxi|parking|bus|matatu|transport|fare|shell|totalenergies|rubis)\b/],
    ['courier', /\b(courier|delivery|parcel|sendy|g4s|dhl|posta|rider|shipping)\b/],
    ['office_supplies', /\b(stationery|pen|paper|notebook|office|supplies|staples)\b/],
    ['printing', /\b(print|printing|photocopy|copy|lamination|binding)\b/],
    ['water', /\b(water|dispenser|refill)\b/],
    ['utilities', /\b(electricity|token|power|kplc|internet|airtime|wifi|utility|utilities)\b/],
    ['software', /\b(software|subscription|license|licence|saas|hosting|domain|cloud)\b/],
    ['hardware', /\b(mouse|keyboard|monitor|laptop|charger|cable|adapter|ssd|ram|hardware|computer)\b/],
    ['maintenance', /\b(repair|service|maintenance|spare|parts|cleaning|plumbing)\b/],
  ]

  return rules.find(([, pattern]) => pattern.test(lower))?.[0] ?? 'other'
}

function extractDescription(lines: string[], category: ExpenseCategory) {
  const blocked = /\b(receipt|invoice|tax invoice|pin|kra|vat|total|subtotal|date|time|cashier|served by|mpesa|m-pesa|till|paybill|tel|phone|email|www|thank you)\b/i
  const merchant = lines.find(line => {
    if (line.length < 3 || line.length > 60) return false
    if (/^\d+$/.test(line)) return false
    if (blocked.test(line)) return false
    return /[a-z]/i.test(line)
  })

  const label = category === 'other' ? 'Receipt expense' : `${category.replace(/_/g, ' ')} expense`
  return `${merchant ?? 'Scanned receipt'} - ${label}`.slice(0, 80)
}

function parseReceiptText(text: string): ReceiptScanResult {
  const today = new Date().toISOString().slice(0, 10)
  const lines = normaliseText(text)
  const joined = lines.join('\n')
  const category = classifyCategory(joined)

  return {
    amount: extractAmount(lines),
    date: extractDate(joined, today),
    description: extractDescription(lines, category),
    category,
    rawText: joined.slice(0, 4000),
    confidence: null,
    engine: 'deed-local-ocr',
  }
}

export async function POST(request: Request) {
  try {
    await getRequiredSession()

    const { imageBase64, mimeType } = await request.json()

    if (!imageBase64 || !mimeType) {
      return NextResponse.json({ error: 'imageBase64 and mimeType are required' }, { status: 400 })
    }

    if (!IMAGE_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: 'Only JPG, PNG, GIF, and WebP receipts can be scanned' }, { status: 400 })
    }

    const buffer = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ''), 'base64')
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Receipt image is empty or invalid' }, { status: 400 })
    }

    const result = await recognize(buffer, 'eng', {
      logger: () => undefined,
    })

    const parsed = parseReceiptText(result.data.text ?? '')
    parsed.confidence = Number.isFinite(result.data.confidence) ? Math.round(result.data.confidence) : null

    if (!parsed.rawText) {
      return NextResponse.json({ error: 'No readable text found on the receipt image' }, { status: 422 })
    }

    return NextResponse.json(parsed)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Scan failed'
    const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
