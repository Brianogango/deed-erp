// ─── Comprehensive Repair Module Types ───────────────────────────────────────

export type RepairStatus =
  | 'pending_verification' // Customer intake, awaiting admin verification
  | 'received'           // Job created, awaiting assignment
  | 'assigned'           // Technician assigned
  | 'diagnosed'          // Diagnosis complete, findings logged
  | 'awaiting_approval'  // Quote sent, waiting for client approval
  | 'approved'           // Client approved, ready to start repair
  | 'awaiting_parts'     // Parts needed, procurement requested
  | 'in_repair'          // Repair in progress
  | 'qc'                 // Quality control/testing
  | 'ready'              // Ready for pickup/delivery
  | 'invoiced'           // Invoice generated
  | 'delivered'          // Handed over to customer
  | 'closed'             // Job completed and closed
  | 'declined'           // Quote declined by customer
  | 'unrepairable'       // Device cannot be repaired
  | 'returned'           // Returned to customer without repair
  | 'cancelled'          // Job cancelled

export type IntakeChannel = 'walk_in' | 'website' | 'whatsapp' | 'call' | 'email'

export type DeliveryMethod = 'pickup' | 'delivery' | 'courier'

export interface RepairAccessory {
  name: string
  received: boolean
  notes?: string
}

export interface RepairDiagnosis {
  findings: string
  faultDescription: string
  recommendedAction: string
  estimatedHours: number
  diagnosedBy: string
  diagnosedDate: string
}

export interface RepairQuoteLine {
  id: string
  type: 'part' | 'labor' | 'logistics'
  description: string
  productId?: string
  productName?: string
  qty: number
  unitPrice: number
  subtotal: number
  reserved: boolean  // Stock reserved for this repair
}

export interface RepairQuote {
  id: string
  lines: RepairQuoteLine[]
  subtotal: number
  tax: number
  total: number
  validUntil: string
  sentDate: string
  approvedDate?: string
  approvedBy?: string
  rejectedDate?: string
  rejectionReason?: string
}

export interface RepairQAItem {
  id: string
  description: string
  passed: boolean
  testedBy?: string
  testedDate?: string
  notes?: string
}

export interface RepairDelivery {
  method: DeliveryMethod
  scheduledDate?: string
  actualDate?: string
  address?: string
  trackingNumber?: string
  recipientName?: string
  recipientPhone?: string
  notes?: string
}

export interface RepairCommunication {
  id: string
  timestamp: string
  channel: 'email' | 'sms' | 'whatsapp' | 'call' | 'portal'
  type: 'intake_confirmation' | 'diagnosis_update' | 'quote_sent' | 'approval_received' | 'progress_update' | 'ready_notification' | 'delivery_confirmation'
  recipient: string
  message: string
  sent: boolean
}

export interface RepairOrder {
  id: string
  ref: string
  status: RepairStatus

  // Customer & Device Info
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  
  productId: string
  productName: string
  serialNumber: string
  serialId?: string
  model?: string
  deviceCondition?: 'good' | 'fair' | 'poor' | 'damaged'
  
  // Intake
  intakeChannel: IntakeChannel
  intakeDate: string
  intakeNotes: string
  issueDescription: string
  accessories: RepairAccessory[]
  
  // Warranty
  warrantyId?: string
  underWarranty: boolean
  warrantyClaimId?: string  // For OEM/supplier claims
  
  // Assignment
  assignedTechnicianId?: string
  assignedTechnicianName?: string
  assignedDate?: string
  
  // Diagnosis
  diagnosis?: RepairDiagnosis
  
  // Quotation
  quote?: RepairQuote
  
  // Repair Execution
  repairStartDate?: string
  repairCompletedDate?: string
  partsUsed: {
    productId: string
    productName: string
    qty: number
    price: number
    serialId?: string
    reservedDate?: string
    usedDate?: string
  }[]
  laborCost: number
  logisticsCost: number
  total: number
  
  // QA
  qcItems: RepairQAItem[]
  qcPassedDate?: string
  qcApprovedBy?: string
  
  // Billing
  invoiceId?: string
  invoiceDate?: string
  
  // Delivery
  delivery?: RepairDelivery
  
  // Communications
  communications: RepairCommunication[]
  
  // Metadata
  createdBy: string
  createdDate: string
  closedDate?: string
  notes: string
  
  // Legacy support
  intakeSource?: 'customer' | 'employee_asset_return'
  linkedEmployeeId?: string
  
  // SLA tracking
  slaDeadline?: string
  slaMissed: boolean
  estimatedCompletionDate?: string
}

export interface RepairPermissions {
  canCreate: boolean
  canViewAll: boolean
  canViewAssigned: boolean
  canAssign: boolean
  canDiagnose: boolean
  canApproveQuote: boolean
  canExecuteRepair: boolean
  canPerformQC: boolean
  canInvoice: boolean
  canClose: boolean
}

export interface ProcurementRequest {
  id: string
  repairId: string
  repairRef: string
  requestedBy: string
  requestedDate: string
  items: {
    productName: string
    description: string
    qty: number
    estimatedCost: number
    supplier?: string
    partNumber?: string
  }[]
  urgency: 'low' | 'normal' | 'high' | 'urgent'
  status: 'pending' | 'ordered' | 'received' | 'cancelled'
  notes: string
  orderedDate?: string
  expectedDelivery?: string
  receivedDate?: string
  orderReference?: string
}
