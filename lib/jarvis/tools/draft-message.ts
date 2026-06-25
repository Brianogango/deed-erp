import 'server-only'

import { z } from 'zod'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  channel: z.enum(['email', 'whatsapp']),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(4000),
  recipientName: z.string().max(200).optional(),
})

// This tool does not send anything and does not call any send endpoint.
// It exists purely to hand the model's drafted text back to the chat UI in
// a structured shape (subject/body/channel) so the UI can render a
// "copy to clipboard" card. Sending still happens exclusively through the
// existing Quote/Invoice send screens.
export const draftMessageTool: ToolDefinition = {
  name: 'draft_message',
  description:
    'Package a drafted email or WhatsApp message for the user to review and copy. Does not send anything — there is no send capability available to you.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', enum: ['email', 'whatsapp'] },
      subject: { type: 'string', description: 'Email subject line (omit for WhatsApp)' },
      body: { type: 'string', description: 'The message body you composed' },
      recipientName: { type: 'string', description: 'Who this message is addressed to, for display only' },
    },
    required: ['channel', 'body'],
  },
  requiredModule: null,
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const parsed = inputSchema.parse(rawInput)
    return {
      draftMessage: parsed,
      reminder: 'This is a draft only. Send it from the relevant Quote/Invoice/Customer screen after review.',
    }
  },
}
