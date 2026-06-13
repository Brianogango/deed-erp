const SERVER_TO_CLIENT_STATUS: Record<string, string> = {
  pending_approval: 'posted',
  approved: 'posted',
  rejected: 'cancelled',
  invoiced: 'posted',
  dispatched: 'posted',
  delivered: 'posted',
  voided: 'cancelled',
  void: 'cancelled',
}

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function asDateString(value: unknown) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
}

function normalizeInvoiceLine(line: any) {
  const qty = asNumber(line?.qty, 1)
  const unitPrice = asNumber(line?.unitPrice)
  const subtotal = line?.subtotal !== undefined || line?.lineSubtotal !== undefined
    ? asNumber(line.subtotal ?? line.lineSubtotal)
    : qty * unitPrice
  const taxRate = asNumber(line?.taxRate)
  const lineTax = line?.lineTax !== undefined ? asNumber(line.lineTax) : Math.round(subtotal * taxRate / 100)

  return {
    id: String(line?.id ?? ''),
    description: String(line?.description ?? line?.productName ?? 'Item'),
    qty,
    unitPrice,
    taxRate,
    subtotal,
    lineTax,
    lineTotal: asNumber(line?.lineTotal, subtotal + lineTax),
    productId: line?.productId ?? undefined,
    accountCode: line?.accountCode ?? undefined,
  }
}

function normalizeInvoicePayment(payment: any) {
  return {
    id: String(payment?.id ?? ''),
    date: asDateString(payment?.date ?? payment?.paidAt ?? payment?.createdAt),
    amount: asNumber(payment?.amount),
    method: String(payment?.method ?? payment?.paymentMethod ?? ''),
    bankAccountId: payment?.bankAccountId ?? undefined,
    reference: payment?.reference ?? undefined,
    journalEntryId: payment?.journalEntryId ?? undefined,
    recordedBy: String(payment?.recordedBy ?? payment?.createdBy?.name ?? payment?.createdBy?.username ?? 'System'),
  }
}

export function normalizeInvoiceForClient(raw: any) {
  const lines: ReturnType<typeof normalizeInvoiceLine>[] = Array.isArray(raw?.lines)
    ? raw.lines.map(normalizeInvoiceLine)
    : Array.isArray(raw?.items)
      ? raw.items.map(normalizeInvoiceLine)
      : []

  const subtotal = raw?.subtotal !== undefined
    ? asNumber(raw.subtotal)
    : lines.reduce((sum: number, line) => sum + line.subtotal, 0)
  const taxTotal = raw?.taxTotal !== undefined || raw?.taxAmount !== undefined
    ? asNumber(raw.taxTotal ?? raw.taxAmount)
    : lines.reduce((sum: number, line) => sum + line.lineTax, 0)
  const total = raw?.total !== undefined || raw?.totalAmount !== undefined
    ? asNumber(raw.total ?? raw.totalAmount)
    : subtotal + taxTotal
  const invoiceNumber = String(raw?.invoiceNumber ?? raw?.ref ?? raw?.id ?? '')
  const client = raw?.client ?? {}
  const status = String(raw?.status ?? 'draft')
  const date = asDateString(raw?.date ?? raw?.invoiceDate ?? raw?.createdAt)

  return {
    ...raw,
    ref: String(raw?.ref ?? invoiceNumber),
    invoiceNumber,
    type: raw?.type ?? 'customer_invoice',
    status: SERVER_TO_CLIENT_STATUS[status] ?? status,
    partnerId: raw?.partnerId ?? raw?.clientId ?? client.id ?? '',
    partnerName: String(raw?.partnerName ?? client.name ?? client.companyName ?? 'Customer'),
    date,
    invoiceDate: date,
    dueDate: asDateString(raw?.dueDate) || date,
    lines,
    items: raw?.items ?? lines,
    subtotal,
    taxTotal,
    taxAmount: taxTotal,
    total,
    totalAmount: total,
    amountPaid: asNumber(raw?.amountPaid),
    payments: Array.isArray(raw?.payments) ? raw.payments.map(normalizeInvoicePayment) : [],
  }
}

export function normalizeInvoicesForClient(rawInvoices: any[]) {
  return rawInvoices.map(normalizeInvoiceForClient)
}
