/**
 * DIA product surfaces — UI modes over the same chat + tool engine.
 *
 * Search · Voice · Insights · Actions · Assist
 */

export type DiaMode = 'search' | 'voice' | 'insights' | 'actions' | 'assist'

export type DiaPageContext = {
  pathname: string
  module?: string | null
  title?: string | null
}

export const DIA_MODES: Array<{
  id: DiaMode
  label: string
  short: string
  description: string
  placeholder: string
  emptyHint: string
}> = [
  {
    id: 'search',
    label: 'Search',
    short: 'Search',
    description: 'Knowledge & policies (RAG)',
    placeholder: 'Search SOPs, warranty, returns, product help…',
    emptyHint:
      'DIA Search looks up website pages, SOPs, and policies. Try warranty, returns, or reconfiguration procedures. Answers cite knowledge sources.',
  },
  {
    id: 'voice',
    label: 'Voice',
    short: 'Voice',
    description: 'Speak questions, hear replies',
    placeholder: 'Tap the mic and ask DIA…',
    emptyHint:
      'DIA Voice uses your browser microphone and spoken replies. Ask stock, repair, or invoice questions out loud. Live Gemini voice is coming later.',
  },
  {
    id: 'insights',
    label: 'Insights',
    short: 'Insights',
    description: 'Live ERP analytics',
    placeholder: 'Ask for sales, repairs, overdue, or lead summaries…',
    emptyHint:
      'DIA Insights summarizes live ERP data — repairs booked, sales totals, overdue invoices, procurement, and inbound leads. Pick a starter or ask in your own words.',
  },
  {
    id: 'actions',
    label: 'Actions',
    short: 'Actions',
    description: 'Drafts & controlled ERP actions',
    placeholder: 'Draft a quote, WhatsApp, or import sales@ leads…',
    emptyHint:
      'DIA Actions prepares drafts for you to confirm — quotations, email/WhatsApp copy, and sales@ lead import. DIA does not send mail or post payments by itself.',
  },
  {
    id: 'assist',
    label: 'Assist',
    short: 'Assist',
    description: 'Help for the page you are on',
    placeholder: 'Ask for help with this screen…',
    emptyHint:
      'DIA Assist uses your current ERP page for contextual help — stock on Inventory, repairs on Repairs, invoices on Finance, and so on.',
  },
]

export type DiaStarter = { label: string; prompt: string }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function startOfWeekIso(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d.toISOString().slice(0, 10)
}

/** Mode-specific starter chips. Insights injects real calendar dates. */
export function startersForMode(mode: DiaMode, page?: DiaPageContext | null): DiaStarter[] {
  const today = todayIso()
  const weekStart = startOfWeekIso()

  switch (mode) {
    case 'search':
      return [
        { label: 'Warranty policy', prompt: 'What is our warranty policy?' },
        { label: 'Returns', prompt: 'What is our returns / refund process?' },
        { label: 'Reconfig SOP', prompt: 'Summarize the device reconfiguration SOP.' },
        { label: 'About Deed', prompt: 'What services does Deed Technologies offer?' },
      ]
    case 'voice':
      return [
        { label: 'Stock check', prompt: 'How many ThinkPad T14 units do we have in stock?' },
        { label: 'Repairs today', prompt: `How many repairs were booked on ${today}?` },
        { label: 'Overdue invoices', prompt: 'Which customer invoices are unpaid and older than 30 days?' },
      ]
    case 'insights':
      return [
        { label: 'Repairs today', prompt: `Summarize repairs booked on ${today}.` },
        { label: 'Sales this week', prompt: `Summarize sales from ${weekStart} to ${today}.` },
        { label: 'Overdue >30d', prompt: 'Show unpaid invoices older than 30 days.' },
        { label: 'Procurement', prompt: 'Give a procurement summary of open POs and receipts.' },
        { label: 'Email leads', prompt: 'Summarize inbound email sales leads.' },
      ]
    case 'actions':
      return [
        { label: 'Draft WhatsApp', prompt: 'Draft a WhatsApp message to a customer about their repair being ready for collection.' },
        { label: 'Draft quote', prompt: 'Help me draft a quotation — ask me for the customer and products.' },
        { label: 'Import sales@ leads', prompt: 'Import new leads from the sales@ inbox now (preview first if possible).' },
        { label: 'Track repair', prompt: 'Help me look up a repair by reference — ask me for the REP number.' },
      ]
    case 'assist':
      return assistStarters(page)
    default:
      return []
  }
}

function assistStarters(page?: DiaPageContext | null): DiaStarter[] {
  const path = String(page?.pathname || '').toLowerCase()
  const module = String(page?.module || '').toLowerCase()
  const key = module || path

  if (key.includes('repair') || path.includes('/repair')) {
    return [
      { label: 'Repairs today', prompt: `How many repairs were booked today (${todayIso()})?` },
      { label: 'Track a repair', prompt: 'Help me track a repair — ask for the reference.' },
      { label: 'Warranty check', prompt: 'How do I verify warranty coverage for a serial?' },
    ]
  }
  if (key.includes('sales') || key.includes('crm') || path.includes('/sales') || path.includes('/crm')) {
    return [
      { label: 'Sales this week', prompt: `Summarize sales this week (${startOfWeekIso()} to ${todayIso()}).` },
      { label: 'Draft quote', prompt: 'Help me draft a quotation for a customer.' },
      { label: 'Email leads', prompt: 'Summarize inbound email sales leads.' },
    ]
  }
  if (key.includes('inventory') || key.includes('stock') || path.includes('/inventory') || path.includes('/operations')) {
    return [
      { label: 'Stock lookup', prompt: 'Help me check stock for a product — ask for the model or SKU.' },
      { label: 'Serial history', prompt: 'How do I look up the history of a serial number?' },
    ]
  }
  if (key.includes('finance') || key.includes('invoice') || path.includes('/finance')) {
    return [
      { label: 'Overdue invoices', prompt: 'Show unpaid invoices older than 30 days.' },
      { label: 'Explain invoice', prompt: 'Help me explain an invoice — ask for the invoice reference.' },
    ]
  }
  if (key.includes('purchase') || path.includes('/purchase')) {
    return [
      { label: 'Procurement', prompt: 'Give a procurement summary of open purchase orders.' },
    ]
  }
  if (key.includes('hr') || path.includes('/hr')) {
    return [
      { label: 'Leave policy', prompt: 'What is our leave application and approval process?' },
      { label: 'Salary advance', prompt: 'How does salary advance approval work?' },
    ]
  }

  return [
    { label: 'What can you do?', prompt: 'What can DIA help me with in the ERP?' },
    { label: 'Stock check', prompt: 'How do I check inventory for a laptop model?' },
    { label: 'Repairs today', prompt: `How many repairs were booked on ${todayIso()}?` },
  ]
}

/** Extra system-prompt bias for the active DIA surface. */
export function modePromptBias(mode: DiaMode): string {
  switch (mode) {
    case 'search':
      return `Active DIA surface: Search (knowledge/RAG).
Prefer retrieved passages and search_documents for policy/SOP/product/help questions.
Do not invent ERP operational numbers — if the user asks live stock/sales/repairs, use live tools.`
    case 'voice':
      return `Active DIA surface: Voice.
Keep answers short and easy to speak aloud (2–5 sentences when possible).
Still use tools for live facts; never invent numbers.`
    case 'insights':
      return `Active DIA surface: Insights (analytics).
Prefer summarize_repairs, summarize_sales, summarize_sales_leads, overdue_payments, procurement_summary, and check_inventory.
Use concrete YYYY-MM-DD dates for "today" / "this week". Lead with the key numbers.`
    case 'actions':
      return `Active DIA surface: Actions.
Prefer draft_quotation, draft_message, track_repair, check_inventory, search_customers, and import_sales_inbox_leads when appropriate.
Remind the user that drafts must be confirmed in the ERP UI. Never claim you sent email/WhatsApp or posted a payment.`
    case 'assist':
      return `Active DIA surface: Assist (contextual).
Use the user's current page context below to tailor help and tool choice.
Offer the next practical step for the screen they are on.`
    default:
      return ''
  }
}

export function formatPageContextForPrompt(page?: DiaPageContext | null): string {
  if (!page?.pathname) return ''
  const bits = [`pathname: ${page.pathname}`]
  if (page.module) bits.push(`module: ${page.module}`)
  if (page.title) bits.push(`title: ${page.title}`)
  return `User page context: ${bits.join(' · ')}.`
}

export function isDiaMode(value: unknown): value is DiaMode {
  return value === 'search' || value === 'voice' || value === 'insights' || value === 'actions' || value === 'assist'
}

/** Map common ERP routes to a coarse module id for Assist. */
export function moduleFromPathname(pathname: string): string | null {
  const p = String(pathname || '').toLowerCase()
  if (p.startsWith('/repair')) return 'repairs'
  if (p.startsWith('/sales')) return 'sales'
  if (p.startsWith('/crm')) return 'crm'
  if (p.startsWith('/finance') || p.startsWith('/cashbook') || p.startsWith('/expenses')) return 'finance'
  if (p.startsWith('/purchase')) return 'purchases'
  if (p.startsWith('/inventory') || p.startsWith('/operations') || p.startsWith('/refurb')) return 'inventory'
  if (p.startsWith('/hr')) return 'hr'
  if (p.startsWith('/delivery')) return 'delivery'
  if (p.startsWith('/pos')) return 'pos'
  if (p === '/' || p.startsWith('/dashboard')) return 'dashboard'
  return null
}
