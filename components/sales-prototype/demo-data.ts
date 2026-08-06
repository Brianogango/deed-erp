/**
 * Sales Module prototype — demo data only.
 * Never import production store / Prisma / saveStoreKeys from these pages.
 */

export type ProtoStatusTone = 'purple' | 'green' | 'amber' | 'red' | 'grey' | 'blue'

export interface ProtoStatus {
  label: string
  tone: ProtoStatusTone
}

export const DEMO_CUSTOMER = {
  id: 'cust-demo-01',
  name: 'Nairobi Tech Hub Ltd',
  contact: 'Amina Wanjiku',
  email: 'amina.w@nairobittech.co.ke',
  phone: '+254 712 448 903',
  billingAddress: '5th Floor, Westlands Business Park\nRing Road, Nairobi',
  deliveryAddress: 'Ground Floor Receiving Bay\nWestlands Business Park, Nairobi',
}

export const DEMO_SALESPERSON = {
  id: 'user-demo-01',
  name: 'Brian Oketch',
  role: 'Sales Representative',
}

export const DEMO_QUOTATIONS = [
  {
    id: 'quo-001',
    ref: 'SQ/2026/0142',
    customer: DEMO_CUSTOMER.name,
    contact: DEMO_CUSTOMER.contact,
    date: '2026-08-04',
    validUntil: '2026-08-18',
    salesperson: DEMO_SALESPERSON.name,
    total: 284_760,
    status: { label: 'Accepted', tone: 'green' as const },
    currency: 'KES',
  },
  {
    id: 'quo-002',
    ref: 'SQ/2026/0141',
    customer: 'Safaricom Business',
    contact: 'James Otieno',
    date: '2026-08-03',
    validUntil: '2026-08-17',
    salesperson: DEMO_SALESPERSON.name,
    total: 512_400,
    status: { label: 'Sent', tone: 'blue' as const },
    currency: 'KES',
  },
  {
    id: 'quo-003',
    ref: 'SQ/2026/0140',
    customer: 'Equity Bank Branch Ops',
    contact: 'Grace Njeri',
    date: '2026-08-01',
    validUntil: '2026-08-08',
    salesperson: 'Mercy Achieng',
    total: 96_280,
    status: { label: 'Expired', tone: 'amber' as const },
    currency: 'KES',
  },
  {
    id: 'quo-004',
    ref: 'SQ/2026/0139',
    customer: 'KCB Digital',
    contact: 'Peter Kamau',
    date: '2026-07-28',
    validUntil: '2026-08-11',
    salesperson: DEMO_SALESPERSON.name,
    total: 1_248_000,
    status: { label: 'Draft', tone: 'grey' as const },
    currency: 'KES',
  },
  {
    id: 'quo-005',
    ref: 'SQ/2026/0138',
    customer: 'Twiga Foods',
    contact: 'Linda Cherono',
    date: '2026-07-22',
    validUntil: '2026-08-05',
    salesperson: 'Mercy Achieng',
    total: 178_500,
    status: { label: 'Converted', tone: 'purple' as const },
    currency: 'KES',
  },
]

export const DEMO_QUOTE_LINES = [
  {
    id: 'ql-1',
    product: 'HP ProBook 450 G10',
    description: 'Intel Core i5-1335U · 16GB · 512GB SSD · 15.6" FHD',
    qty: 4,
    uom: 'Unit',
    unitPrice: 52_500,
    taxRate: 16,
    discount: 0,
    serialTracked: true,
    available: 11,
    reserved: 0,
    warehouse: 'Warehouse',
    warranty: '12 months',
    leadTime: '2–3 days',
  },
  {
    id: 'ql-2',
    product: 'Dell Latitude 5440',
    description: 'Intel Core i7-1355U · 16GB · 512GB SSD · Refurbished Grade A',
    qty: 2,
    uom: 'Unit',
    unitPrice: 48_900,
    taxRate: 16,
    discount: 5,
    serialTracked: true,
    available: 6,
    reserved: 0,
    warehouse: 'Warehouse',
    warranty: '6 months',
    leadTime: 'Same day',
  },
  {
    id: 'ql-3',
    product: 'Logitech MK270 Wireless Kit',
    description: 'Keyboard + mouse combo — bulk accessories',
    qty: 6,
    uom: 'Kit',
    unitPrice: 2_850,
    taxRate: 16,
    discount: 0,
    serialTracked: false,
    available: 84,
    reserved: 12,
    warehouse: 'Shop',
    warranty: 'Manufacturer',
    leadTime: 'Same day',
  },
]

export function lineAmount(line: (typeof DEMO_QUOTE_LINES)[0]) {
  const base = line.qty * line.unitPrice * (1 - line.discount / 100)
  return Math.round(base * 100) / 100
}

export function quoteTotals(lines = DEMO_QUOTE_LINES) {
  const untaxed = lines.reduce((s, l) => s + lineAmount(l), 0)
  const tax = Math.round(untaxed * 0.16 * 100) / 100
  const total = Math.round((untaxed + tax) * 100) / 100
  const cost = 198_400
  const margin = total - cost
  const marginPct = total ? Math.round((margin / total) * 1000) / 10 : 0
  return { untaxed, tax, discount: 4_890, delivery: 0, total, cost, margin, marginPct, currency: 'KES' }
}

export const DEMO_SO = {
  id: 'so-001',
  ref: 'SO/2026/0087',
  sourceQuote: 'SQ/2026/0142',
  status: { label: 'Confirmed', tone: 'purple' as const },
  customer: DEMO_CUSTOMER,
  salesperson: DEMO_SALESPERSON.name,
  orderDate: '2026-08-05',
  expectedDelivery: '2026-08-08',
  paymentTerms: 'Net 30',
  currency: 'KES',
  workflow: [
    { key: 'confirmed', label: 'Confirmed', state: 'done' as const },
    { key: 'reserved', label: 'Reserved', state: 'current' as const },
    { key: 'ready', label: 'Ready to Deliver', state: 'todo' as const },
    { key: 'delivered', label: 'Delivered', state: 'todo' as const },
    { key: 'invoiced', label: 'Invoiced', state: 'todo' as const },
    { key: 'paid', label: 'Paid', state: 'todo' as const },
  ],
  reservation: {
    status: 'Partially Reserved',
    reservedAt: '2026-08-05 14:22',
    reservedBy: 'Inventory · Jane Muthoni',
    warehouse: 'Warehouse',
    shortages: '2 × Dell Latitude 5440 awaiting intake',
  },
  lines: [
    {
      product: 'HP ProBook 450 G10',
      description: 'i5 · 16GB · 512GB',
      ordered: 4,
      reserved: 4,
      picked: 0,
      delivered: 0,
      invoiced: 0,
      uom: 'Unit',
      unitPrice: 52_500,
      taxRate: 16,
      status: { label: 'Reserved', tone: 'green' as const },
    },
    {
      product: 'Dell Latitude 5440',
      description: 'i7 · Refurb A',
      ordered: 2,
      reserved: 0,
      picked: 0,
      delivered: 0,
      invoiced: 0,
      uom: 'Unit',
      unitPrice: 46_455,
      taxRate: 16,
      status: { label: 'Shortage', tone: 'amber' as const },
    },
    {
      product: 'Logitech MK270 Kit',
      description: 'Keyboard + mouse',
      ordered: 6,
      reserved: 6,
      picked: 0,
      delivered: 0,
      invoiced: 0,
      uom: 'Kit',
      unitPrice: 2_850,
      taxRate: 16,
      status: { label: 'Reserved', tone: 'green' as const },
    },
  ],
  related: {
    deliveries: [{ ref: 'DN/2026/0044', status: 'Waiting' }],
    invoices: [] as { ref: string; status: string }[],
    payments: [] as { ref: string; amount: number }[],
  },
  paid: 0,
}

export const DEMO_DELIVERY = {
  id: 'dn-001',
  ref: 'DN/2026/0044',
  status: { label: 'Picking', tone: 'blue' as const },
  type: 'Delivery',
  warehouse: 'Warehouse',
  scheduled: '2026-08-08',
  source: 'SO/2026/0087',
  customer: DEMO_CUSTOMER.name,
  address: DEMO_CUSTOMER.deliveryAddress,
  responsible: 'Jane Muthoni',
  lines: [
    {
      product: 'HP ProBook 450 G10',
      description: 'Serial-tracked notebook',
      required: 4,
      picked: 2,
      uom: 'Unit',
      serialTracked: true,
      availableSerials: [
        { serial: '5CG8412A', grade: 'A', location: 'WH-A1', sku: 'HP-PB450-G10' },
        { serial: '5CG8412B', grade: 'A', location: 'WH-A1', sku: 'HP-PB450-G10' },
        { serial: '5CG8399C', grade: 'A', location: 'WH-A2', sku: 'HP-PB450-G10' },
        { serial: '5CG8401D', grade: 'B', location: 'WH-A2', sku: 'HP-PB450-G10' },
      ],
      selectedSerials: ['5CG8412A', '5CG8412B'],
      sourceLocation: 'WH-A1',
      destLocation: 'Customer',
      status: { label: 'Partial', tone: 'amber' as const },
    },
    {
      product: 'Logitech MK270 Kit',
      description: 'Quantity-tracked accessory',
      required: 6,
      picked: 6,
      uom: 'Kit',
      serialTracked: false,
      availableQty: 72,
      reservedQty: 6,
      sourceLocation: 'Shop-Bin-12',
      destLocation: 'Customer',
      status: { label: 'Complete', tone: 'green' as const },
    },
  ],
}

export const DEMO_INVOICE = {
  id: 'inv-001',
  ref: 'INV/2026/0312',
  status: { label: 'Posted', tone: 'purple' as const },
  customer: DEMO_CUSTOMER,
  invoiceDate: '2026-08-08',
  dueDate: '2026-09-07',
  paymentTerms: 'Net 30',
  salesOrder: 'SO/2026/0087',
  delivery: 'DN/2026/0044',
  currency: 'KES',
  untaxed: 245_480,
  tax: 39_276.8,
  total: 284_756.8,
  paid: 150_000,
  balance: 134_756.8,
  lines: [
    {
      product: 'HP ProBook 450 G10',
      ordered: 4,
      delivered: 4,
      previouslyInvoiced: 0,
      invoicing: 4,
      remaining: 0,
      uom: 'Unit',
      unitPrice: 52_500,
      taxRate: 16,
      amount: 210_000,
    },
    {
      product: 'Logitech MK270 Kit',
      ordered: 6,
      delivered: 6,
      previouslyInvoiced: 0,
      invoicing: 6,
      remaining: 0,
      uom: 'Kit',
      unitPrice: 2_850,
      taxRate: 16,
      amount: 17_100,
    },
  ],
  payments: [
    {
      date: '2026-08-08',
      ref: 'PAY/2026/0881',
      method: 'M-Pesa',
      journal: 'Bank · Equity 017',
      amount: 150_000,
      status: { label: 'Posted', tone: 'green' as const },
      receivedBy: 'Finance · Brian',
    },
  ],
}

export const PROTO_NAV = [
  { href: '/sales-prototype/quotations', label: 'Quotations', page: 'quotations' },
  { href: '/sales-prototype/quotations/new', label: 'Create quotation', page: 'create' },
  { href: '/sales-prototype/quotations/quo-001', label: 'Quotation detail', page: 'quote-detail' },
  { href: '/sales-prototype/orders/so-001', label: 'Sales order', page: 'order' },
  { href: '/sales-prototype/deliveries/dn-001', label: 'Delivery picking', page: 'delivery' },
  { href: '/sales-prototype/invoices/new', label: 'Create invoice', page: 'invoice-create' },
  { href: '/sales-prototype/invoices/inv-001', label: 'Invoice & payment', page: 'invoice' },
]

export function formatKes(n: number) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
