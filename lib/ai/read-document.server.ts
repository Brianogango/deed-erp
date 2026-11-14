import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'

/**
 * Read a photo or PDF into structured fields with Claude. One place for the
 * model, the request shape and the failure messages, shared by every scanner
 * (receipts, purchase documents, cheques, delivery documents).
 */

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

const fail = (message: string, status: number) => Object.assign(new Error(message), { status })

export const hasClaudeKey = () => Boolean((process.env.ANTHROPIC_API_KEY || '').trim())

export const NO_AI_KEY_MESSAGE = 'Scanning needs an AI key on the server (ANTHROPIC_API_KEY). Type the details in instead.'

const documentModel = () => process.env.ANTHROPIC_DOCUMENT_MODEL || 'claude-opus-5-5'

function sourceBlock(base64: string, mimeType: string) {
  return mimeType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as ImageType, data: base64 } }
}

function mapApiError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) throw fail('The AI key on the server was rejected — check ANTHROPIC_API_KEY.', 503)
  if (err instanceof Anthropic.RateLimitError) throw fail('The scanner is busy — try again in a minute.', 429)
  if (err instanceof Anthropic.APIConnectionError) throw fail('The server could not reach the scanner — check its internet connection.', 503)
  throw err
}

export async function readDocumentWithClaude<S extends z.ZodType>(args: {
  base64: string
  mimeType: string
  schema: S
  instructions: string
  /** Shown when the document cannot be read. */
  unreadable: string
  maxTokens?: number
}): Promise<{ data: z.infer<S>; engine: string }> {
  if (!hasClaudeKey()) throw fail(NO_AI_KEY_MESSAGE, 503)
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = documentModel()
  const response = await client.messages.parse({
    model,
    max_tokens: args.maxTokens ?? 4000,
    messages: [{ role: 'user', content: [sourceBlock(args.base64, args.mimeType), { type: 'text', text: args.instructions }] }],
    output_config: { format: zodOutputFormat(args.schema) },
  }).catch(mapApiError)
  if (response.stop_reason === 'max_tokens') throw fail('The document is too long to read in one go — split it, or type the details in.', 422)
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw fail(args.unreadable, 422)
  return { data: response.parsed_output as z.infer<S>, engine: model }
}

/** Plain text of a photo or PDF, as written. Empty when nothing is readable. */
export async function transcribeWithClaude(base64: string, mimeType: string): Promise<string> {
  if (!hasClaudeKey()) throw fail(NO_AI_KEY_MESSAGE, 503)
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: documentModel(),
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: [
        sourceBlock(base64, mimeType),
        { type: 'text', text: 'Transcribe all the text in this document exactly as written, in reading order. Output only the text, with no commentary. If there is no readable text, output nothing.' },
      ],
    }],
  }).catch(mapApiError)
  if (response.stop_reason === 'refusal') return ''
  return response.content.map(block => (block.type === 'text' ? block.text : '')).join('').trim()
}
