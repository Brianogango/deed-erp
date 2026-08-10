import 'server-only'

import type { ToolDefinition } from '../types'
import { searchCustomersTool } from './search-customers'
import { checkInventoryTool } from './check-inventory'
import { explainInvoiceTool } from './explain-invoice'
import { trackRepairTool } from './track-repair'
import { checkWarrantyTool } from './check-warranty'
import { summarizeSalesTool } from './summarize-sales'
import { summarizeRepairsTool } from './summarize-repairs'
import { overduePaymentsTool } from './overdue-payments'
import { procurementSummaryTool } from './procurement-summary'
import { draftQuotationTool } from './draft-quotation'
import { draftMessageTool } from './draft-message'
import { searchDocumentsTool } from './search-documents'

const REGISTRY: ToolDefinition[] = [
  searchCustomersTool,
  checkInventoryTool,
  explainInvoiceTool,
  trackRepairTool,
  checkWarrantyTool,
  summarizeSalesTool,
  summarizeRepairsTool,
  overduePaymentsTool,
  procurementSummaryTool,
  draftQuotationTool,
  draftMessageTool,
  searchDocumentsTool,
]

const BY_NAME = new Map(REGISTRY.map(t => [t.name, t]))

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name)
}

export function allTools(): ToolDefinition[] {
  return REGISTRY
}

/** @deprecated Prefer provider-agnostic tool defs via chat-engine / provider layer. */
export function anthropicToolsFor(allowedNames: string[]) {
  return REGISTRY
    .filter(t => allowedNames.includes(t.name))
    .map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as any,
    }))
}
