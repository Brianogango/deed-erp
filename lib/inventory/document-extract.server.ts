import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai'
import { z } from 'zod'
import type { InboundSourceRow } from '@/lib/inventory/inbound-import'

/**
 * Read a supplier's invoice / delivery note (PDF or photo) into rows for the
 * Inbound import. Uses whichever AI key the server has: Anthropic first,
 * then Gemini. The result is only a draft — the person checks every line,
 * product and serial before anything is received.
 */

const DeliverySchema = z.object({
  supplierName: z.string(),
  documentReference: z.string(),
  documentDate: z.string(),
  lines: z.array(z.object({
    product: z.string(),
    sku: z.string(),
    qty: z.number(),
    unitCost: z.number(),
    serials: z.array(z.string()),
  })),
})
export type DeliveryExtract = { supplierName: string; documentReference: string; documentDate: string; rows: InboundSourceRow[]; engine: string }

const INSTRUCTIONS = `This is a supplier invoice, delivery note or packing list for computer equipment received by a shop in Kenya.
Extract every product line exactly as written:
- product: the item description as printed (model, key specs).
- sku: the item / part code if one is printed, else "".
- qty: units on that line.
- unitCost: price per unit before VAT in the document's currency as a plain number; 0 if not shown.
- serials: every serial number, service tag or IMEI listed for that line (often under the line or in a separate list). Copy them character by character; do not invent or complete any. Empty list if none are printed.
Also give supplierName, documentReference (invoice / delivery note number) and documentDate (YYYY-MM-DD, or "" if absent).
Skip totals, VAT, delivery charges and payment details.`

export function documentReaderConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean((env.ANTHROPIC_API_KEY || '').trim() || (env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || '').trim())
}

function toResult(data: z.infer<typeof DeliverySchema>, engine: string): DeliveryExtract {
  return {
    supplierName: data.supplierName.trim(),
    documentReference: data.documentReference.trim(),
    documentDate: /^\d{4}-\d{2}-\d{2}$/.test(data.documentDate) ? data.documentDate : '',
    rows: data.lines
      .filter(l => l.product.trim() || l.sku.trim() || l.serials.length)
      .map(l => ({
        product: l.product.trim(),
        sku: l.sku.trim() || undefined,
        qty: l.qty > 0 ? l.qty : null,
        unitCost: l.unitCost > 0 ? l.unitCost : null,
        serials: l.serials.map(s => s.trim().toUpperCase()).filter(s => s.length >= 3),
      })),
    engine,
  }
}

async function readWithAnthropic(base64: string, mimeType: string): Promise<DeliveryExtract> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = process.env.ANTHROPIC_DOCUMENT_MODEL || 'claude-opus-5-5'
  const source = mimeType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: base64 } }
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: [source, { type: 'text', text: INSTRUCTIONS }] }],
    output_config: { format: zodOutputFormat(DeliverySchema) },
  })
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('The document could not be read'), { status: 422 })
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('The document is too long to read in one go — split it, or use the Excel template'), { status: 422 })
  if (!response.parsed_output) throw Object.assign(new Error('The document could not be read'), { status: 422 })
  return toResult(response.parsed_output, model)
}

const GEMINI_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    supplierName: { type: SchemaType.STRING },
    documentReference: { type: SchemaType.STRING },
    documentDate: { type: SchemaType.STRING },
    lines: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          product: { type: SchemaType.STRING },
          sku: { type: SchemaType.STRING },
          qty: { type: SchemaType.NUMBER },
          unitCost: { type: SchemaType.NUMBER },
          serials: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ['product', 'sku', 'qty', 'unitCost', 'serials'],
      },
    },
  },
  required: ['supplierName', 'documentReference', 'documentDate', 'lines'],
}

async function readWithGemini(base64: string, mimeType: string): Promise<DeliveryExtract> {
  const client = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim())
  const modelName = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest'
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0 },
  })
  const result = await model.generateContent([{ inlineData: { mimeType, data: base64 } }, { text: INSTRUCTIONS }])
  const parsed = DeliverySchema.safeParse(JSON.parse(result.response.text() || '{}'))
  if (!parsed.success) throw Object.assign(new Error('The document could not be read'), { status: 422 })
  return toResult(parsed.data, modelName)
}

export async function readDeliveryDocument(base64: string, mimeType: string): Promise<DeliveryExtract> {
  if ((process.env.ANTHROPIC_API_KEY || '').trim()) return readWithAnthropic(base64, mimeType)
  if ((process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim()) return readWithGemini(base64, mimeType)
  throw Object.assign(new Error('Reading PDFs and photos needs an AI key on the server (ANTHROPIC_API_KEY or GEMINI_API_KEY). Use the Excel template instead.'), { status: 503 })
}
