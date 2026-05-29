// ─── Portal Repair Data ───────────────────────────────────────────────────────
// Shared data for the public client-facing repair tracking portal.
// In production this would read from a database; for demo it mirrors seed data.

export type PortalRepairStatus =
  | 'received' | 'assigned' | 'diagnosed'
  | 'awaiting_approval' | 'approved'
  | 'awaiting_parts' | 'in_repair' | 'qc'
  | 'ready' | 'invoiced' | 'delivered' | 'closed'
  | 'declined' | 'unrepairable' | 'returned' | 'cancelled'

export interface PortalQuoteLine {
  type: 'part' | 'labor' | 'logistics'
  description: string
  qty: number
  unitPrice: number
  subtotal: number
}

export interface PortalRepair {
  ref: string
  status: PortalRepairStatus
  customerName: string
  customerPhone: string
  customerEmail?: string
  productName: string
  serialNumber: string
  deviceCondition?: string
  intakeChannel: string
  intakeDate: string
  estimatedCompletionDate?: string
  issueDescription: string
  accessories: { name: string; received: boolean; notes?: string }[]
  assignedTechnicianName?: string
  diagnosis?: {
    findings: string
    faultDescription: string
    recommendedAction: string
    estimatedHours: number
    diagnosedDate: string
  }
  quote?: {
    lines: PortalQuoteLine[]
    subtotal: number
    tax: number
    total: number
    validUntil: string
    sentDate: string
    approvedDate?: string
    approvedBy?: string
    rejectedDate?: string
    rejectionReason?: string
    changeSummary?: string
    prevTotal?: number
  }
  statusHistory: { status: PortalRepairStatus; date: string; note?: string }[]
  repairStartDate?: string
  delivery?: { method: string; scheduledDate?: string; address?: string }
  closedDate?: string
  slaMissed: boolean
  underWarranty: boolean
  notes?: string
  preRepairPhotos?: string[]
  qcReportData?: string
  qcReportName?: string
  diagnosisReportData?: string
  diagnosisReportName?: string
}

// Module-level approval decisions (in-memory store for demo)
export const approvalDecisions = new Map<
  string,
  { approved: boolean; reason?: string; date: string }
>()

// ─── Messaging ───────────────────────────────────────────────────────────────
export interface RepairMessage {
  id: string
  repairRef: string
  sender: 'customer' | 'staff'
  senderName: string
  text: string
  timestamp: string
  read: boolean
}

export const repairMessages = new Map<string, RepairMessage[]>()

export function getMessages(ref: string): RepairMessage[] {
  return repairMessages.get(normaliseRef(ref)) ?? []
}

export function addMessage(
  ref: string,
  msg: Omit<RepairMessage, 'id' | 'repairRef'>
): RepairMessage {
  const key = normaliseRef(ref)
  const message: RepairMessage = {
    ...msg, id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    repairRef: decodeURIComponent(ref),
  }
  repairMessages.set(key, [...(repairMessages.get(key) ?? []), message])
  return message
}

export function markMessagesRead(ref: string, byRole: 'customer' | 'staff') {
  const key = normaliseRef(ref)
  const msgs = repairMessages.get(key)
  if (!msgs) return
  repairMessages.set(key, msgs.map(m =>
    m.sender !== byRole ? { ...m, read: true } : m
  ))
}

function normaliseRef(ref: string) {
  return decodeURIComponent(ref).toUpperCase()
}

// ─── Dynamic repair registry (populated via /api/portal/repair/sync) ─────────
// Pinned to `global` so Next.js hot-reloads don't wipe the Map between requests
const g = global as typeof global & { _portalRepairs?: Map<string, PortalRepair> }
if (!g._portalRepairs) g._portalRepairs = new Map()
const registeredRepairs = g._portalRepairs

export function registerPortalRepair(repair: PortalRepair) {
  registeredRepairs.set(repair.ref.toUpperCase(), repair)
}

export const PORTAL_REPAIRS: PortalRepair[] = [
  // ── REP/0038 — Canon printer, currently in_repair ────────────────────────
  {
    ref: 'REP/0038',
    status: 'in_repair',
    customerName: 'Alice Njoki',
    customerPhone: '+254 712 345 004',
    customerEmail: 'alice.njoki@example.com',
    productName: 'Canon i-SENSYS MF3010',
    serialNumber: 'GG2QPXXX0012',
    deviceCondition: 'fair',
    intakeChannel: 'walk_in',
    intakeDate: '2026-04-13',
    estimatedCompletionDate: '2026-04-15',
    issueDescription: 'Paper feed jam and print quality issue',
    accessories: [
      { name: 'Power Cable', received: true },
      { name: 'USB Cable', received: true },
    ],
    assignedTechnicianName: 'Brian Kamau',
    diagnosis: {
      findings: 'Worn feed roller and toner cartridge issue',
      faultDescription: 'Paper feed roller shows excessive wear. Toner streaking suggests cartridge near end of life.',
      recommendedAction: 'Replace feed roller assembly and toner cartridge',
      estimatedHours: 2,
      diagnosedDate: '2026-04-13',
    },
    quote: {
      lines: [
        { type: 'part',   description: 'Feed Roller Assembly (OEM)',   qty: 1, unitPrice: 3500, subtotal: 3500 },
        { type: 'labor',  description: 'Labour & Service Charge',       qty: 1, unitPrice: 5000, subtotal: 5000 },
      ],
      subtotal: 8500,
      tax: 1360,
      total: 9860,
      validUntil: '2026-04-20',
      sentDate: '2026-04-13',
      approvedDate: '2026-04-13',
      approvedBy: 'customer',
    },
    statusHistory: [
      { status: 'received',          date: '2026-04-13', note: 'Device checked in at front desk' },
      { status: 'assigned',          date: '2026-04-13', note: 'Assigned to Brian Kamau' },
      { status: 'diagnosed',         date: '2026-04-13', note: 'Feed roller wear identified' },
      { status: 'awaiting_approval', date: '2026-04-13', note: 'Quote sent via WhatsApp & email' },
      { status: 'approved',          date: '2026-04-13', note: 'Quote approved by customer' },
      { status: 'in_repair',         date: '2026-04-14', note: 'Repair in progress' },
    ],
    repairStartDate: '2026-04-14',
    slaMissed: false,
    underWarranty: false,
  },

  // ── REP/0039 — MacBook Pro, diagnosed, quote not yet sent ────────────────
  {
    ref: 'REP/0039',
    status: 'diagnosed',
    customerName: 'David Otieno',
    customerPhone: '+254 733 500 600',
    productName: 'MacBook Pro M3 14"',
    serialNumber: 'C02ZK1XXXQ6L',
    deviceCondition: 'good',
    intakeChannel: 'call',
    intakeDate: '2026-04-14',
    estimatedCompletionDate: '2026-04-17',
    issueDescription: 'Battery swelling detected',
    accessories: [
      { name: 'Charger', received: true },
      { name: 'USB-C Cable', received: false, notes: 'Customer kept cable' },
    ],
    assignedTechnicianName: 'Brian Kamau',
    diagnosis: {
      findings: 'Battery cell damage causing swelling',
      faultDescription: 'Battery pack shows physical swelling. Safety risk identified. No liquid damage detected.',
      recommendedAction: 'Replace battery pack immediately',
      estimatedHours: 3,
      diagnosedDate: '2026-04-14',
    },
    statusHistory: [
      { status: 'received',  date: '2026-04-14', note: 'Device booked via phone call' },
      { status: 'assigned',  date: '2026-04-14', note: 'Assigned to Brian Kamau' },
      { status: 'diagnosed', date: '2026-04-14', note: 'Battery swelling confirmed' },
    ],
    slaMissed: false,
    underWarranty: false,
  },

  // ── REP/0040 — iPhone 15 Pro, awaiting client quote approval ─────────────
  {
    ref: 'REP/0040',
    status: 'awaiting_approval',
    customerName: 'Grace Akinyi',
    customerPhone: '+254 700 888 999',
    customerEmail: 'grace.akinyi@gmail.com',
    productName: 'iPhone 15 Pro 256GB',
    serialNumber: 'F2LXK9XXXD5P',
    deviceCondition: 'poor',
    intakeChannel: 'walk_in',
    intakeDate: '2026-04-15',
    estimatedCompletionDate: '2026-04-18',
    issueDescription: 'Screen shattered, front camera not focusing',
    accessories: [
      { name: 'Lightning Cable', received: false, notes: 'Not provided' },
      { name: 'Case', received: true },
    ],
    assignedTechnicianName: 'Brian Kamau',
    diagnosis: {
      findings: 'OLED screen cracked across full display. Front camera module dislodged from impact.',
      faultDescription: 'Drop damage — screen is shattered with dead zones in lower half. Front TrueDepth camera module has come loose, causing focus and Face ID failure.',
      recommendedAction: 'Replace OLED display assembly and reseat/replace front camera module',
      estimatedHours: 2,
      diagnosedDate: '2026-04-15',
    },
    quote: {
      lines: [
        { type: 'part',   description: 'iPhone 15 Pro OLED Display Assembly (OEM)', qty: 1, unitPrice: 32000, subtotal: 32000 },
        { type: 'part',   description: 'Front TrueDepth Camera Module',              qty: 1, unitPrice: 8500,  subtotal: 8500  },
        { type: 'labor',  description: 'Labour & Service Charge',                     qty: 1, unitPrice: 6000,  subtotal: 6000  },
      ],
      subtotal: 46500,
      tax: 7440,
      total: 53940,
      validUntil: '2026-04-19',
      sentDate: '2026-04-15',
    },
    statusHistory: [
      { status: 'received',          date: '2026-04-15', note: 'Device checked in at front desk' },
      { status: 'assigned',          date: '2026-04-15', note: 'Assigned to Brian Kamau' },
      { status: 'diagnosed',         date: '2026-04-15', note: 'Screen and camera damage confirmed' },
      { status: 'awaiting_approval', date: '2026-04-15', note: 'Quote sent — awaiting your approval' },
    ],
    slaMissed: false,
    underWarranty: false,
    notes: 'Customer requested same-day turnaround if parts are available.',
  },
]

/** Look up a repair by ref and apply any in-memory approval decisions */
export function getPortalRepair(ref: string): PortalRepair | null {
  const decoded = decodeURIComponent(ref)
  const repair =
    registeredRepairs.get(decoded.toUpperCase()) ??
    PORTAL_REPAIRS.find(r => r.ref.toLowerCase() === decoded.toLowerCase())
  if (!repair) return null

  const decision = approvalDecisions.get(ref.toUpperCase())
  if (!decision) return { ...repair }

  // Apply the approval decision on top of the base data
  if (decision.approved) {
    return {
      ...repair,
      status: 'approved',
      quote: repair.quote
        ? { ...repair.quote, approvedDate: decision.date, approvedBy: 'customer' }
        : repair.quote,
      statusHistory: [
        ...repair.statusHistory,
        { status: 'approved', date: decision.date, note: 'Quote approved by customer via portal' },
      ],
    }
  } else {
    return {
      ...repair,
      status: 'declined',
      quote: repair.quote
        ? { ...repair.quote, rejectedDate: decision.date, rejectionReason: decision.reason }
        : repair.quote,
      statusHistory: [
        ...repair.statusHistory,
        { status: 'declined', date: decision.date, note: decision.reason ?? 'Quote declined by customer' },
      ],
    }
  }
}
