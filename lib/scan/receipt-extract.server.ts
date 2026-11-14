import 'server-only'
import { z } from 'zod'
import { readDocumentWithClaude } from '@/lib/ai/read-document.server'

/** Read a photo of an expense receipt into a draft claim. The person checks it before submitting. */

export const RECEIPT_CATEGORIES = [
  'courier', 'office_supplies', 'water', 'printing',
  'transport', 'meals', 'utilities', 'software',
  'hardware', 'maintenance', 'rent', 'service_charge', 'electricity',
  'internet', 'insurance', 'bank_charges', 'interest', 'other',
] as const

const ReceiptSchema = z.object({
  amount: z.number(),
  date: z.string(),
  description: z.string(),
  category: z.enum(RECEIPT_CATEGORIES),
})

const INSTRUCTIONS = `This is a photo of a receipt for a business expense in Kenya (KES). Read it exactly as printed:
- amount: the total paid, as a plain number with no currency or commas. Use the grand total including VAT, not a subtotal, the cash tendered or the change. For an M-Pesa message use the amount sent, not the balance or the transaction cost. 0 if unreadable.
- date: the date on the receipt as YYYY-MM-DD. Dates are written day first. "" if no date is readable. Do not guess.
- description: a short description for the claim, in the form "<what was bought> — <seller>" (for example "White bread and milk — Naivas"). At most 100 characters.
- category: the best match for what was bought: ${RECEIPT_CATEGORIES.join(', ')}. Use "other" when unsure.
Never invent a value you cannot read.`

export type ReceiptExtract = { amount: number | null; date: string; description: string; category: typeof RECEIPT_CATEGORIES[number]; engine: string }

export async function readReceiptImage(base64: string, mimeType: string): Promise<ReceiptExtract> {
  const { data, engine } = await readDocumentWithClaude({
    base64, mimeType, schema: ReceiptSchema, instructions: INSTRUCTIONS, maxTokens: 2000,
    unreadable: 'The receipt could not be read — take a clearer photo or fill in the details yourself',
  })
  return {
    amount: data.amount > 0 ? Math.round(data.amount * 100) / 100 : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : '',
    description: data.description.trim().slice(0, 200),
    category: data.category,
    engine,
  }
}
