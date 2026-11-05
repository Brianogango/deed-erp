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
import { createQuotationTool } from './create-quotation'
import { createInvoiceTool } from './create-invoice'
import { draftMessageTool } from './draft-message'
import { searchDocumentsTool } from './search-documents'
import { summarizeSalesLeadsTool } from './summarize-sales-leads'
import { importSalesInboxLeadsTool } from './import-sales-inbox-leads'
import { searchVendorsTool } from './search-vendors'
import { createContactTool } from './create-contact'
import { createProductTool } from './create-product'
import { createPurchaseOrderTool } from './create-purchase-order'
import { runReportTool } from './run-report'

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
  createQuotationTool,
  createInvoiceTool,
  draftMessageTool,
  searchDocumentsTool,
  summarizeSalesLeadsTool,
  importSalesInboxLeadsTool,
  searchVendorsTool,
  createContactTool,
  createProductTool,
  createPurchaseOrderTool,
  runReportTool,
]

const BY_NAME = new Map(REGISTRY.map(t => [t.name, t]))

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name)
}

export function allTools(): ToolDefinition[] {
  return REGISTRY
}
