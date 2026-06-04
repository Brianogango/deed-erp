import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { recognize } from 'tesseract.js'
import { getRequiredSession } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_LINES = 80

type PurchaseScanLine = {
  productName: string
  qty: number
  unitPrice: number
  taxRate: number
  lineTotal: number | null
  rawLine: string
}

type PurchaseScanResult = {
  vendorName: string
  date: string
  reference: string
  subtotal: number | null
  taxTotal: number | null
  total: number | null
  lines: PurchaseScanLine[]
  rawText: string
  confidence: number | null
  engine: 'deed-local-purchase-ocr'
}

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
  const cleaned = token.replace(/[^\d.,-]/g, '')
  if (!cleaned) return null

  const normalised = cleaned.includes(',') && cleaned.includes('.')
    ? cleaned.replace(/,/g, '')
    : cleaned.replace(/,/g, '')

  const value = Number(normalised)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function extractAmounts(line: string) {
  const matches = Array.from(line.matchAll(/\d{1,3}(?:[, ]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g))
  return matches
    .map(match => ({ raw: match[0], value: parseAmountToken(match[0]), index: match.index ?? 0 }))
    .filter((match): match is { raw: string; value: number; index: number } => match.value !== null && match.value < 100_000_000)
}

function toIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return date.toISOString().slice(0, 10)
}

function extractDate(text: string) {
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

  return ''
}

function extractReference(lines: string[]) {
  const refLine = lines.find(line => /\b(invoice|inv|quotation|quote|receipt|lpo|po|reference|ref)\b/i.test(line) && /[a-z0-9-]{4,}/i.test(line))
  if (!refLine) return ''

  const labelled = refLine.match(/\b(?:invoice|inv|quotation|quote|receipt|lpo|po|reference|ref)(?:\s*(?:no|number|#|:|=))?\s*[:#=-]?\s*([a-z0-9][a-z0-9\-/]{2,})\b/i)
  if (labelled?.[1]) return labelled[1].slice(0, 40)

  const fallback = refLine.match(/\b[A-Z0-9][A-Z0-9\-/]{3,}\b/i)
  return fallback?.[0]?.slice(0, 40) ?? ''
}

function extractVendorName(lines: string[]) {
  const blocked = /\b(tax invoice|invoice|quotation|quote|receipt|pin|kra|vat|total|subtotal|date|time|tel|phone|email|www|qty|quantity|description|amount|unit|price|mpesa|m-pesa|paybill|till)\b/i
  return lines.find(line => {
    if (line.length < 3 || line.length > 70) return false
    if (blocked.test(line)) return false
    if (/^\d+$/.test(line)) return false
    return /[a-z]/i.test(line)
  }) ?? ''
}

function extractLabelledAmount(lines: string[], labels: RegExp, avoid?: RegExp) {
  const candidates = lines
    .filter(line => labels.test(line) && !(avoid?.test(line)))
    .flatMap(extractAmounts)
    .map(item => item.value)
  return candidates.length > 0 ? Math.max(...candidates) : null
}

function isLikelyNonItemLine(line: string) {
  return /\b(invoice|quotation|quote|receipt|supplier|customer|buyer|seller|pin|kra|vat no|vat number|subtotal|sub total|grand total|total due|amount due|balance|paid|change|date|time|terms|bank|account|paybill|till|mpesa|m-pesa|email|www|tel|phone|address|page|thank you|served by|cashier|qty\s+description|description\s+qty|unit\s+price)\b/i.test(line)
}

function tidyProductName(name: string) {
  return name
    .replace(/^[\-–—*•\d.)\s]+/, '')
    .replace(/\b(ksh|kes|each|pcs|pc|unit|units)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 120)
}

function makeLine(rawLine: string, qtyTokenIndex: number, qty: number, unitPrice: number, taxRate: number, lineTotal: number | null): PurchaseScanLine | null {
  const productName = tidyProductName(rawLine.slice(0, qtyTokenIndex))
  if (productName.length < 2 || !/[a-z]/i.test(productName)) return null
  if (!Number.isFinite(qty) || qty <= 0 || qty > 10_000) return null
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100_000_000) return null

  return {
    productName,
    qty: Number(qty.toFixed(2)),
    unitPrice: Number(unitPrice.toFixed(2)),
    taxRate,
    lineTotal: lineTotal === null ? null : Number(lineTotal.toFixed(2)),
    rawLine,
  }
}

function parseItemLine(line: string, defaultTaxRate: number): PurchaseScanLine | null {
  if (isLikelyNonItemLine(line)) return null

  const amounts = extractAmounts(line)
  if (amounts.length < 2) return null

  if (amounts.length >= 3) {
    const qtyCandidate = amounts[amounts.length - 3]
    const unitCandidate = amounts[amounts.length - 2]
    const totalCandidate = amounts[amounts.length - 1]
    const expectedTotal = qtyCandidate.value * unitCandidate.value
    const tolerance = Math.max(2, totalCandidate.value * 0.18)

    if (qtyCandidate.value > 0 && qtyCandidate.value <= 10_000 && Math.abs(expectedTotal - totalCandidate.value) <= tolerance) {
      return makeLine(line, qtyCandidate.index, qtyCandidate.value, unitCandidate.value, defaultTaxRate, totalCandidate.value)
    }
  }

  const qtyCandidate = amounts[amounts.length - 2]
  const unitCandidate = amounts[amounts.length - 1]
  if (qtyCandidate.value > 0 && qtyCandidate.value <= 10_000) {
    return makeLine(line, qtyCandidate.index, qtyCandidate.value, unitCandidate.value, defaultTaxRate, null)
  }

  return null
}

function parsePurchaseText(text: string): PurchaseScanResult {
  const lines = normaliseText(text)
  const joined = lines.join('\n')
  const defaultTaxRate = /\b(vat|tax invoice|taxable|v\.a\.t)\b/i.test(joined) ? 16 : 0

  const parsedLines: PurchaseScanLine[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const parsed = parseItemLine(line, defaultTaxRate)
    if (!parsed) continue
    const key = `${parsed.productName.toLowerCase()}|${parsed.qty}|${parsed.unitPrice}`
    if (seen.has(key)) continue
    seen.add(key)
    parsedLines.push(parsed)
    if (parsedLines.length >= MAX_LINES) break
  }

  return {
    vendorName: extractVendorName(lines),
    date: extractDate(joined),
    reference: extractReference(lines),
    subtotal: extractLabelledAmount(lines, /\b(subtotal|sub total)\b/i),
    taxTotal: extractLabelledAmount(lines, /\b(vat|tax)\b/i, /\b(pin|kra|vat no|vat number)\b/i),
    total: extractLabelledAmount(lines, /\b(grand total|total due|amount due|invoice total|total)\b/i, /\b(subtotal|sub total|tax|vat)\b/i),
    lines: parsedLines,
    rawText: joined.slice(0, 6000),
    confidence: null,
    engine: 'deed-local-purchase-ocr',
  }
}

async function normaliseForOcr(buffer: Buffer) {
  return sharp(buffer, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalise()
    .png()
    .toBuffer()
}

export async function POST(request: Request) {
  try {
    await getRequiredSession()

    const { imageBase64, mimeType } = await request.json()

    if (!imageBase64 || !mimeType) {
      return NextResponse.json({ error: 'imageBase64 and mimeType are required' }, { status: 400 })
    }

    if (!IMAGE_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: 'Only JPG, PNG, and WebP purchase document images can be scanned' }, { status: 400 })
    }

    const buffer = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ''), 'base64')
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Purchase document image is empty or invalid' }, { status: 400 })
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Purchase document image is too large. Please upload an image under 8 MB.' }, { status: 413 })
    }

    const ocrBuffer = await normaliseForOcr(buffer)
    const result = await recognize(ocrBuffer, 'eng', { logger: () => undefined })

    const parsed = parsePurchaseText(result.data.text ?? '')
    parsed.confidence = Number.isFinite(result.data.confidence) ? Math.round(result.data.confidence) : null

    if (!parsed.rawText) {
      return NextResponse.json({ error: 'No readable text found on the purchase document image' }, { status: 422 })
    }
    if (parsed.lines.length === 0) {
      return NextResponse.json({ error: 'Text was found, but no purchase line items could be extracted', rawText: parsed.rawText }, { status: 422 })
    }

    return NextResponse.json(parsed)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Purchase document scan failed'
    const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
