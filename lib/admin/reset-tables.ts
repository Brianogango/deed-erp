import 'server-only'
import prisma from '@/lib/prisma'

/**
 * Wipe structured Prisma tables using correct @@map names (ARCH-001).
 * Children are cleared before parents. Returns the list of cleared model labels.
 */
export async function clearStructuredErpTables(): Promise<string[]> {
  const cleared: string[] = []

  // Order matters for FK constraints — leaf tables first.
  const steps: Array<{ label: string; run: () => Promise<unknown> }> = [
    { label: 'payment_allocations', run: () => prisma.paymentAllocation.deleteMany() },
    { label: 'payments', run: () => prisma.payment.deleteMany() },
    { label: 'invoice_items', run: () => prisma.invoiceItem.deleteMany() },
    { label: 'invoices', run: () => prisma.invoice.deleteMany() },
    { label: 'sale_order_items', run: () => prisma.saleOrderItem.deleteMany() },
    { label: 'sale_orders', run: () => prisma.saleOrder.deleteMany() },
    { label: 'purchase_order_items', run: () => prisma.purchaseOrderItem.deleteMany() },
    { label: 'purchase_orders', run: () => prisma.purchaseOrder.deleteMany() },
    { label: 'repair_parts', run: () => prisma.repairPart.deleteMany() },
    { label: 'repair_stages', run: () => prisma.repairStage.deleteMany() },
    { label: 'repair_diagnostics', run: () => prisma.repairDiagnostic.deleteMany() },
    { label: 'repair_client_communications', run: () => prisma.repairClientCommunication.deleteMany() },
    { label: 'repairs', run: () => prisma.repair.deleteMany() },
    { label: 'serial_numbers', run: () => prisma.serialNumber.deleteMany() },
    { label: 'kilimall_order_items', run: () => prisma.kilimallOrderItem.deleteMany() },
    { label: 'kilimall_orders', run: () => prisma.kilimallOrder.deleteMany() },
    { label: 'employees', run: () => prisma.employee.deleteMany() },
    { label: 'clients', run: () => prisma.client.deleteMany() },
    { label: 'product_images', run: () => prisma.productImage.deleteMany() },
    { label: 'products', run: () => prisma.product.deleteMany() },
    { label: 'company_settings', run: () => prisma.companySetting.deleteMany() },
  ]

  for (const step of steps) {
    await step.run()
    cleared.push(step.label)
  }

  return cleared
}
