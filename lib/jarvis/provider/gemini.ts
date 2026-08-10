import 'server-only'

import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Content,
  type Part,
  type Schema,
} from '@google/generative-ai'
import type { JarvisLlmProvider, JarvisToolDef, JarvisToolLoopArgs, JarvisToolLoopResult } from './types'
import { JARVIS_MAX_TOKENS, JARVIS_MAX_TOOL_ROUNDS } from './types'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (_client) return _client
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured — JARVIS (Gemini) is disabled until it is set')
  }
  _client = new GoogleGenerativeAI(apiKey)
  return _client
}

/** Map JSON Schema → Gemini function declaration parameters (recursive). */
export function jsonSchemaToGeminiSchema(raw: Record<string, unknown> | undefined | null): Schema {
  if (!raw || typeof raw !== 'object') {
    return { type: SchemaType.STRING } as Schema
  }

  const t = String(raw.type || 'string').toLowerCase()

  if (t === 'array') {
    const itemsRaw = (raw.items && typeof raw.items === 'object')
      ? raw.items as Record<string, unknown>
      : { type: 'string' }
    return {
      type: SchemaType.ARRAY,
      description: raw.description ? String(raw.description) : undefined,
      items: jsonSchemaToGeminiSchema(itemsRaw),
    } as Schema
  }

  if (t === 'object') {
    const propertiesIn = (raw.properties && typeof raw.properties === 'object')
      ? raw.properties as Record<string, Record<string, unknown>>
      : {}
    const properties: Record<string, Schema> = {}
    for (const [key, prop] of Object.entries(propertiesIn)) {
      properties[key] = jsonSchemaToGeminiSchema(prop)
    }
    // Gemini rejects OBJECT properties that omit nested fields; always include properties.
    return {
      type: SchemaType.OBJECT,
      description: raw.description ? String(raw.description) : undefined,
      properties,
      required: Array.isArray(raw.required) ? raw.required.map(String) : undefined,
    } as Schema
  }

  let type: SchemaType = SchemaType.STRING
  if (t === 'number' || t === 'integer') type = SchemaType.NUMBER
  else if (t === 'boolean') type = SchemaType.BOOLEAN

  return {
    type,
    description: raw.description ? String(raw.description) : undefined,
    ...(Array.isArray(raw.enum) ? { enum: raw.enum.map(String) } : {}),
  } as Schema
}

/** Top-level tool parameters must be a Gemini OBJECT schema. */
export function toGeminiParameters(schema: Record<string, unknown>): FunctionDeclaration['parameters'] {
  const converted = jsonSchemaToGeminiSchema({
    type: 'object',
    properties: (schema.properties as Record<string, unknown>) ?? {},
    required: schema.required,
    description: schema.description,
  })
  return converted as FunctionDeclaration['parameters']
}

function toGeminiTools(tools: JarvisToolDef[]): FunctionDeclaration[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: toGeminiParameters(t.inputSchema),
  }))
}

function historyToContents(history: JarvisToolLoopArgs['history']): Content[] {
  return history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

export function createGeminiJarvisProvider(): JarvisLlmProvider {
  // Flash for routine ERP Q&A / drafts — cost-efficient and replaceable via env.
  const model = process.env.GEMINI_MODEL || process.env.JARVIS_MODEL || 'gemini-flash-latest'

  return {
    id: 'gemini',
    model,
    async runToolLoop(args: JarvisToolLoopArgs): Promise<JarvisToolLoopResult> {
      const client = getClient()
      const maxRounds = args.maxRounds || JARVIS_MAX_TOOL_ROUNDS
      const maxTokens = args.maxTokens || JARVIS_MAX_TOKENS
      const functionDeclarations = toGeminiTools(args.tools)

      const generativeModel = client.getGenerativeModel({
        model,
        systemInstruction: args.system,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.2,
        },
        tools: functionDeclarations.length > 0
          ? [{ functionDeclarations }]
          : undefined,
        toolConfig: functionDeclarations.length > 0
          ? { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
          : undefined,
      })

      const contents: Content[] = [
        ...historyToContents(args.history),
        { role: 'user', parts: [{ text: args.userMessage }] },
      ]

      const toolCalls: JarvisToolLoopResult['toolCalls'] = []
      let lastText = ''

      for (let round = 0; round < maxRounds; round += 1) {
        const result = await generativeModel.generateContent({ contents })
        const response = result.response
        const candidate = response.candidates?.[0]
        const parts: Part[] = candidate?.content?.parts ?? []

        const functionCalls = parts.filter(p => Boolean((p as { functionCall?: unknown }).functionCall))
        const textParts = parts
          .map(p => ('text' in p && p.text ? p.text : ''))
          .filter(Boolean)
        if (textParts.length) lastText = textParts.join('\n').trim()

        if (functionCalls.length === 0) {
          const text = (lastText || response.text?.() || '').trim()
          return {
            reply: text || "I don't have a response for that.",
            toolCalls,
            provider: 'gemini',
            model,
          }
        }

        // Echo model turn (including functionCall parts) then append function responses.
        contents.push({
          role: 'model',
          parts,
        })

        const responseParts: Part[] = []
        for (const part of functionCalls) {
          const fc = (part as { functionCall: { name: string; args?: Record<string, unknown> } }).functionCall
          const name = fc.name
          const input = (fc.args ?? {}) as Record<string, unknown>
          const outcome = await args.onToolCall(name, input)
          toolCalls.push({
            toolName: name,
            input,
            allowed: outcome.allowed,
            output: outcome.output,
            error: outcome.error,
          })
          const resultPayload = outcome.allowed
            ? (outcome.error ? { error: outcome.error } : outcome.output)
            : { error: outcome.error ?? 'Permission denied' }
          // Gemini rejects oversized function responses — keep them compact.
          let responseObj: object
          try {
            const raw = JSON.stringify(resultPayload)
            const clipped = raw.length > 8000
              ? { truncated: true, preview: raw.slice(0, 7800) }
              : JSON.parse(raw)
            responseObj = typeof clipped === 'object' && clipped !== null ? clipped : { result: clipped }
          } catch {
            responseObj = { error: 'Failed to serialise tool result' }
          }
          responseParts.push({
            functionResponse: {
              name,
              response: responseObj,
            },
          })
        }

        contents.push({
          role: 'user',
          parts: responseParts,
        })
      }

      return {
        reply: lastText
          || 'I needed too many tool calls to answer that — please narrow your question and try again.',
        toolCalls,
        provider: 'gemini',
        model,
      }
    },
  }
}
