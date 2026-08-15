import { isPosBankPayment } from '@/lib/pos-session'

export type PosReceiptLine = {
  productName?: string
  qty?: number
  serialId?: string
  serialNumber?: string
}

export type PosHistoryTicket = {
  id: string
  ref: string
  invoiceRef?: string
  customerName?: string
  payment?: string
  date: string
  createdAt?: string
  lines?: PosReceiptLine[]
}

export function resolvePosLineSerial(
  line: PosReceiptLine,
  serials: { id: string; serial?: string }[] = [],
): string | undefined {
  const direct = (line.serialNumber || '').trim()
  if (direct) return direct
  if (!line.serialId) return undefined
  const found = serials.find(serial => serial.id === line.serialId)
  const serial = (found?.serial || '').trim()
  return serial || undefined
}

export function formatPosReceiptProduct(line: PosReceiptLine, serials?: { id: string; serial?: string }[]): string {
  const name = (line.productName || '').trim() || 'Item'
  const serial = resolvePosLineSerial(line, serials)
  return serial ? `${name} · SN ${serial}` : name
}

function fmtTicketDate(date: string): string {
  try {
    return new Date(date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return date
  }
}

export function ticketWhen(order: PosHistoryTicket): string {
  if (order.createdAt) {
    const at = new Date(order.createdAt)
    if (!Number.isNaN(at.getTime())) {
      return at.toLocaleString('en-KE', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }
  return fmtTicketDate(order.date)
}

export function ticketLines(order: PosHistoryTicket, serials?: { id: string; serial?: string }[]): string {
  const names = (order.lines ?? []).map(line => formatPosReceiptProduct(line, serials))
  if (names.length === 0) return '—'
  if (names.length === 1) return names[0]
  return `${names[0]} +${names.length - 1}`
}

export function payLabel(order: PosHistoryTicket): string {
  return isPosBankPayment(order.payment) ? 'Bank' : (order.payment || '—')
}

export function filterPosHistoryOrders<T extends PosHistoryTicket>(
  orders: T[],
  query: string,
  serials: { id: string; serial?: string }[] = [],
): T[] {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? orders.filter(order => {
        const hay = [
          order.ref,
          order.invoiceRef,
          order.customerName,
          payLabel(order),
          ...(order.lines ?? []).flatMap(line => [
            line.productName,
            line.serialNumber,
            resolvePosLineSerial(line, serials),
          ]),
        ].join(' ').toLowerCase()
        return hay.includes(needle)
      })
    : orders
  return [...filtered].sort((a, b) => {
    const aAt = a.createdAt ? Date.parse(a.createdAt) : 0
    const bAt = b.createdAt ? Date.parse(b.createdAt) : 0
    return bAt - aAt
  })
}
