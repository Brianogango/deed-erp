import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai'
import { z } from 'zod'
import { normalizeChequeDate } from './cheque-rules'

/**
 * Read a photo of a cheque into the fields of the cheque register. Uses
 * whichever AI key the server has: Anthropic first, then Gemini. The result is
 * only a draft — the person checks every field before the cheque is saved.
 */

const ChequeSchema = z.object({
  chequeNumber: z.string(),
  bankName: z.string(),
  payeeName: z.string(),
  accountName: z.string(),
  amount: z.number(),
  amountInWords: z.string(),
  date: z.string(),
  crossed: z.boolean(),
})

export type ChequeExtract = {
  chequeNumber: string
  bankName: string
  /** The name after "Pay" — who the cheque is made out to. */
  payeeName: string
  /** The account holder printed on the cheque — who is paying. */
  accountName: string
  amount: number | null
  /** YYYY-MM-DD, or '' when the date could not be read. */
  chequeDate: string
  /** What looks wrong or unreadable, for the person to check. */
  warnings: string[]
  engine: string
}

const INSTRUCTIONS = `This is a photo of a bank cheque issued in Kenya (KES). Read it exactly as written:
- chequeNumber: the cheque number, usually the 6-digit number at the top right and at the start of the printed line along the bottom. Digits only, keep leading zeros. "" if unreadable.
- bankName: the bank's name as printed (for example "Equity Bank", "KCB", "Co-operative Bank"). "" if not shown.
- payeeName: the name written after "Pay" — who the cheque is made out to. "" if blank or "Cash"/"Bearer" only: then write "Cash".
- accountName: the account holder printed on the cheque (usually bottom right, above the signature, or under the bank name). "" if not shown.
- amount: the amount in figures as a plain number with no currency or commas. 0 if unreadable.
- amountInWords: the amount written in words, as written. "" if blank.
- date: the date written on the cheque exactly as written (day first), for example "05/10/2026" or "5 Oct 2026". "" if no date is written. Do not guess a missing day, month or year.
- crossed: true if the cheque has two parallel lines across the face (crossed), else false.
Copy characters carefully. Never invent or complete a value you cannot read; leave it empty instead.`

function toResult(data: z.infer<typeof ChequeSchema>, engine: string): ChequeExtract {
  const warnings: string[] = []
  const chequeDate = normalizeChequeDate(data.date)
  if (!chequeDate) warnings.push(data.date.trim() ? `The date “${data.date.trim()}” could not be read — enter it yourself.` : 'No date is written on the cheque — enter the date it can be banked.')
  if (!(data.amount > 0)) warnings.push('The amount could not be read — enter it yourself.')
  if (!data.chequeNumber.trim()) warnings.push('The cheque number could not be read — enter it yourself.')
  if (!data.amountInWords.trim()) warnings.push('The amount in words is blank — the bank may refuse this cheque.')
  return {
    chequeNumber: data.chequeNumber.replace(/[^0-9A-Za-z-]/g, '').slice(0, 40),
    bankName: data.bankName.trim().slice(0, 120),
    payeeName: data.payeeName.trim().slice(0, 200),
    accountName: data.accountName.trim().slice(0, 200),
    amount: data.amount > 0 ? Math.round(data.amount * 100) / 100 : null,
    chequeDate,
    warnings,
    engine,
  }
}

async function readWithAnthropic(base64: string, mimeType: string): Promise<ChequeExtract> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = process.env.ANTHROPIC_DOCUMENT_MODEL || 'claude-opus-5-5'
  const response = await client.messages.parse({
    model,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: base64 } },
        { type: 'text', text: INSTRUCTIONS },
      ],
    }],
    output_config: { format: zodOutputFormat(ChequeSchema) },
  })
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw Object.assign(new Error('The cheque could not be read — take a clearer photo or type the details in'), { status: 422 })
  }
  return toResult(response.parsed_output, model)
}

const GEMINI_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    chequeNumber: { type: SchemaType.STRING },
    bankName: { type: SchemaType.STRING },
    payeeName: { type: SchemaType.STRING },
    accountName: { type: SchemaType.STRING },
    amount: { type: SchemaType.NUMBER },
    amountInWords: { type: SchemaType.STRING },
    date: { type: SchemaType.STRING },
    crossed: { type: SchemaType.BOOLEAN },
  },
  required: ['chequeNumber', 'bankName', 'payeeName', 'accountName', 'amount', 'amountInWords', 'date', 'crossed'],
}

async function readWithGemini(base64: string, mimeType: string): Promise<ChequeExtract> {
  const client = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim())
  const modelName = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest'
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0 },
  })
  const result = await model.generateContent([{ inlineData: { mimeType, data: base64 } }, { text: INSTRUCTIONS }])
  const parsed = ChequeSchema.safeParse(JSON.parse(result.response.text() || '{}'))
  if (!parsed.success) throw Object.assign(new Error('The cheque could not be read — take a clearer photo or type the details in'), { status: 422 })
  return toResult(parsed.data, modelName)
}

export async function readChequeImage(base64: string, mimeType: string): Promise<ChequeExtract> {
  if ((process.env.ANTHROPIC_API_KEY || '').trim()) return readWithAnthropic(base64, mimeType)
  if ((process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim()) return readWithGemini(base64, mimeType)
  throw Object.assign(new Error('Scanning a cheque needs an AI key on the server (ANTHROPIC_API_KEY or GEMINI_API_KEY). Type the details in instead.'), { status: 503 })
}
