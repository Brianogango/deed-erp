const SERVER_TO_CLIENT_STATUS: Record<string, string> = {
  pending_approval: 'sent',
  approved: 'accepted',
  rejected: 'rejected',
  cancelled: 'expired',
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

function normalizeQuoteLine(line: any) {
  const qty = asNumber(line.qty, 1)
  const unitPrice = asNumber(line.unitPrice)
  const discount = asNumber(line.discount ?? line.discountPct)
  const subtotal = line.subtotal !== undefined || line.lineSubtotal !== undefined
    ? asNumber(line.subtotal ?? line.lineSubtotal)
    : Math.round(qty * unitPrice * (1 - discount / 100))
  const taxAmount = line.taxAmount !== undefined || line.lineTax !== undefined
    ? asNumber(line.taxAmount ?? line.lineTax)
    : Math.round(subtotal * asNumber(line.taxRate) / 100)
  const lineTotal = line.lineTotal !== undefined
    ? asNumber(line.lineTotal)
    : subtotal + taxAmount

  return {
    id: String(line.id ?? ''),
    productId: String(line.productId ?? ''),
    productName: String(line.productName ?? line.description ?? 'Item'),
    sku: String(line.sku ?? ''),
    description: String(line.description ?? line.productName ?? 'Item'),
    qty,
    unit: String(line.unit ?? 'unit'),
    listPrice: asNumber(line.listPrice ?? line.unitPrice),
    unitPrice,
    discount,
    discountAmount: asNumber(line.discountAmount),
    taxRate: asNumber(line.taxRate),
    taxAmount,
    subtotal,
    lineTotal,
    notes: line.notes ?? undefined,
  }
}

export function normalizeQuoteForClient(raw: any) {
  const lines: ReturnType<typeof normalizeQuoteLine>[] = Array.isArray(raw?.lines)
    ? raw.lines.map(normalizeQuoteLine)
    : Array.isArray(raw?.items)
      ? raw.items.map(normalizeQuoteLine)
      : []
  const subtotal = raw?.subtotal !== undefined
    ? asNumber(raw.subtotal)
    : lines.reduce((sum: number, line) => sum + line.subtotal, 0)
  const taxTotal = raw?.taxTotal !== undefined || raw?.taxAmount !== undefined
    ? asNumber(raw.taxTotal ?? raw.taxAmount)
    : lines.reduce((sum: number, line) => sum + line.taxAmount, 0)
  const total = raw?.total !== undefined || raw?.totalAmount !== undefined
    ? asNumber(raw.total ?? raw.totalAmount)
    : subtotal + taxTotal
  const quoteNumber = String(raw?.quoteNumber ?? raw?.ref ?? raw?.id ?? '')
  const client = raw?.client ?? {}
  const opportunity = raw?.opportunity ?? {}
  const status = String(raw?.status ?? 'draft')

  return {
    ...raw,
    quoteNumber,
    ref: String(raw?.ref ?? quoteNumber),
    clientId: raw?.clientId ?? client.id,
    companyId: raw?.companyId ?? raw?.clientId ?? client.id ?? '',
    companyName: String(raw?.companyName ?? client.companyName ?? client.name ?? 'Customer'),
    contactPersonId: raw?.contactPersonId,
    contactPersonName: String(raw?.contactPersonName ?? client.contactPersonName ?? client.name ?? 'Customer'),
    contactPersonEmail: raw?.contactPersonEmail ?? client.email,
    contactPersonPhone: raw?.contactPersonPhone ?? client.phone,
    opportunityName: String(raw?.opportunityName ?? opportunity.name ?? raw?.subject ?? ''),
    ownerId: raw?.ownerId ?? raw?.assignedToId ?? raw?.createdById,
    ownerName: String(raw?.ownerName ?? raw?.assignedTo?.name ?? raw?.createdBy?.name ?? 'Sales'),
    status: SERVER_TO_CLIENT_STATUS[status] ?? status,
    quoteDate: asDateString(raw?.quoteDate ?? raw?.issueDate ?? raw?.createdAt),
    issueDate: asDateString(raw?.issueDate ?? raw?.quoteDate ?? raw?.createdAt),
    validUntil: asDateString(raw?.validUntil),
    sentDate: raw?.sentDate ? asDateString(raw.sentDate) : undefined,
    viewedDate: raw?.viewedDate ? asDateString(raw.viewedDate) : undefined,
    acceptedDate: raw?.acceptedDate ? asDateString(raw.acceptedDate) : undefined,
    rejectedDate: raw?.rejectedDate ? asDateString(raw.rejectedDate) : undefined,
    viewCount: asNumber(raw?.viewCount),
    version: asNumber(raw?.version, 1),
    subtotal,
    discountAmount: asNumber(raw?.discountAmount),
    discountPct: asNumber(raw?.discountPct ?? raw?.discountPercent),
    discountPercent: asNumber(raw?.discountPercent ?? raw?.discountPct),
    taxAmount: taxTotal,
    taxTotal,
    totalAmount: total,
    total,
    paymentTerms: raw?.paymentTerms ?? raw?.terms ?? '30 days',
    lines,
    items: raw?.items ?? lines,
  }
}

export function normalizeQuotesForClient(rawQuotes: any[]) {
  return rawQuotes.map(normalizeQuoteForClient)
}
