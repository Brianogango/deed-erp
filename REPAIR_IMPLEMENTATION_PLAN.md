# Comprehensive Repair Module Implementation Plan
**Deed Technologies ERP - End-to-End Repair Workflow**

## Current Implementation Status (April 15, 2026)

### ✅ Completed
- Basic repair order structure
- Simple warranty check function
- Parts tracking in repair orders
- Basic status workflow (6 states)
- Integration with inventory for parts
- Serial number tracking

### ❌ Missing Critical Features
1. **Complete Workflow States** (Currently 6, need 12)
2. **Technician Assignment & Access Control**
3. **Quotation Approval Flow**
4. **Stock Reservation Before Repair**
5. **Diagnosis Logging**
6. **QA/Testing Stage**
7. **Delivery/Pickup Tracking**
8. **Communication Automation**
9. **Role-Based Visibility**
10. **SLA Tracking**

---

## Phase 1: Core Workflow Enhancement (HIGH PRIORITY)

### 1.1 Expand Repair Status Flow
**Current**: `draft → confirmed → under_repair → done → invoiced → cancelled`

**Target**:
```
received → assigned → diagnosed → awaiting_approval → approved 
→ in_repair → qc → ready → invoiced → delivered → closed → cancelled
```

**Files to Update**:
- `lib/store.tsx` - Update `RepairOrder` interface
- `components/modules/Repair.tsx` - Update status stepper
- Add status validation rules

### 1.2 Add Technician Assignment
**Requirements**:
- Add `assignedTechnicianId` and `assignedDate` fields
- Create role-based filter: technicians see ONLY assigned jobs
- Add assignment UI in repair detail view
- Implement auto-assignment logic based on workload/skill

**Implementation**:
```typescript
// In store.tsx
assignTechnician: (repairId: string, technicianId: string) => void

// Access control
const canViewRepair = (repair: RepairOrder, currentUser: User) => {
  if (currentUser.role === 'super_admin' || currentUser.role === 'admin') return true
  if (currentUser.role === 'repair_manager') return true
  if (currentUser.role === 'repair_tech') {
    return repair.assignedTechnicianId === currentUser.id
  }
  return false
}
```

### 1.3 Implement Quotation Workflow
**Flow**:
1. After diagnosis → Generate quote
2. Quote includes: parts + labor + logistics
3. Send to customer (email/WhatsApp/portal)
4. Wait for approval
5. On approval → Reserve parts from inventory
6. Proceed to repair

**New Functions**:
```typescript
generateQuote: (repairId: string, lines: QuoteLine[]) => void
sendQuoteToCustomer: (repairId: string) => void
approveQuote: (repairId: string, approved: boolean, reason?: string) => void
reservePartsForRepair: (repairId: string) => boolean
```

### 1.4 Stock Reservation System
**Critical**: Parts must be reserved BEFORE repair starts, not after

**Implementation**:
```typescript
// When quote is approved
reservePartsForRepair: (repairId: string) => {
  const repair = repairs.find(r => r.id === repairId)
  const quote = repair.quote
  
  for (const line of quote.lines) {
    if (line.type === 'part') {
      // Check stock availability
      // Mark stock as 'reserved' with repair ID
      // Update serial status to 'assigned'
      // Prevent other repairs from using these parts
    }
  }
}

// When repair completes
consumeReservedParts: (repairId: string) => {
  // Move from 'reserved' to 'used'
  // Deduct from stock
  // Update inventory moves
}
```

---

## Phase 2: Quality & Billing Integration

### 2.1 Add Diagnosis Stage
**Fields**:
- `diagnosis.findings`
- `diagnosis.faultDescription`
- `diagnosis.recommendedAction`
- `diagnosis.estimatedHours`
- `diagnosis.diagnosedBy`
- `diagnosis.diagnosedDate`

**UI Component**: Diagnosis form in repair detail view

### 2.2 Implement QA Checklist
**Flow**:
After repair → Before marking "ready"

**QA Items**:
```typescript
interface QAItem {
  id: string
  description: string  // e.g., "Device powers on", "All functions tested"
  passed: boolean
  testedBy: string
  testedDate: string
  notes: string
}
```

**Actions**:
- Add QA items template
- Technician/QA person checks each item
- All items must pass before status → `ready`

### 2.3 Wire to Accounting
**Warranty Logic**:
```typescript
if (repair.underWarranty) {
  // Option 1: No invoice to customer
  // Option 2: Zero-value invoice for tracking
  // Track claim separately for OEM/supplier
} else {
  // Generate normal invoice
  // Parts + Labor + Logistics
  createInvoiceFromRepair(repairId)
}
```

**Invoice Generation**:
```typescript
createInvoiceFromRepair: (repairId: string) => {
  const repair = repairs.find(r => r.id === repairId)
  
  const lines: InvoiceLine[] = [
    // Parts
    ...repair.partsUsed.map(part => ({
      description: `Part: ${part.productName}`,
      qty: part.qty,
      unitPrice: part.price,
      subtotal: part.qty * part.price
    })),
    // Labor
    {
      description: 'Labor & Service',
      qty: 1,
      unitPrice: repair.laborCost,
      subtotal: repair.laborCost
    },
    // Logistics (if applicable)
    ...(repair.delivery ? [{
      description: 'Delivery Service',
      qty: 1,
      unitPrice: repair.logisticsCost,
      subtotal: repair.logisticsCost
    }] : [])
  ]
  
  createInvoice({
    type: 'customer_invoice',
    partnerId: repair.customerId,
    partnerName: repair.customerName,
    lines,
    repairId: repair.id
  })
}
```

---

## Phase 3: Delivery & Communication

### 3.1 Delivery/Pickup Tracking
**Fields**:
```typescript
delivery: {
  method: 'pickup' | 'delivery' | 'courier'
  scheduledDate: string
  actualDate: string
  address: string
  trackingNumber: string
  recipientName: string
  recipientPhone: string
  notes: string
}
```

**Status Flow**:
- When QA passed → Status: `ready`
- Customer notified
- Schedule pickup/delivery
- On handover → Status: `delivered`
- Payment confirmed → Status: `closed`

### 3.2 Communication Automation
**Trigger Points**:
1. **Job Created** → "Repair job {REF} received. We'll update you shortly."
2. **Diagnosed** → "Diagnosis complete. Quote: {AMOUNT}. Approve via link."
3. **Quote Approved** → "Repair approved. Estimated completion: {DATE}"
4. **In Repair** → "Your device is being repaired by {TECHNICIAN}"
5. **Ready** → "Device ready for pickup at {LOCATION}"
6. **Delivered** → "Thank you! Repair completed."

**Implementation**:
```typescript
sendNotification: (repairId: string, type: NotificationType) => {
  const repair = repairs.find(r => r.id === repairId)
  const customer = contacts.find(c => c.id === repair.customerId)
  
  const messages = {
    intake_confirmation: `Repair job ${repair.ref} received...`,
    diagnosis_update: `Diagnosis complete. Issue: ${repair.diagnosis.findings}...`,
    quote_sent: `Quote for ${repair.ref}: ${fmtKes(repair.quote.total)}...`,
    ready_notification: `Your ${repair.productName} is ready for pickup!`,
    // etc.
  }
  
  // Send via:
  // - Email (if customer.email exists)
  // - SMS (if configured)
  // - WhatsApp (if integrated)
  // - Customer portal notification
  
  logCommunication(repair.id, type, customer.phone, messages[type])
}
```

---

## Phase 4: Advanced Features

### 4.1 SLA Tracking
**Implementation**:
```typescript
// When job created
slaDeadline: calculateSLA(repair.intakeDate, priority, deviceType)

// Monitor
repair.slaMissed = new Date() > new Date(repair.slaDeadline)

// Alert if approaching deadline
if (hoursToDeadline < 4) {
  notifyManager(repair)
}
```

### 4.2 Technician Performance Metrics
**Track**:
- Jobs completed
- Average resolution time
- Customer satisfaction (if feedback collected)
- Repeat repairs (quality indicator)

### 4.3 Device Lifecycle Tracking
**By Serial Number**:
- Purchase date
- Sale date
- Repair history
- Warranty claims
- Current status

**UI**: Device history view showing timeline

### 4.4 Customer Portal
**Features**:
- Track repair status live
- View quote and approve online
- Upload photos of device
- Rate service after completion

---

## Implementation Order

### Week 1
1. ✅ Expand `RepairOrder` type (DONE - see `lib/repair-types.ts`)
2. Add technician assignment fields
3. Implement role-based access control
4. Update Repair.tsx with new fields

### Week 2
1. Build quotation workflow UI
2. Implement stock reservation
3. Add diagnosis logging
4. Update status stepper

### Week 3
1. Add QA checklist
2. Wire repair invoicing
3. Implement warranty logic in billing
4. Test complete flow

### Week 4
1. Add delivery tracking
2. Implement communication triggers
3. Build notification system
4. Polish UI/UX

---

## Database Schema Changes

When moving to production database:

```sql
CREATE TABLE repairs (
  id VARCHAR PRIMARY KEY,
  ref VARCHAR UNIQUE NOT NULL,
  status VARCHAR NOT NULL,
  customer_id VARCHAR REFERENCES contacts(id),
  
  -- Device
  product_id VARCHAR,
  product_name VARCHAR,
  serial_number VARCHAR,
  serial_id VARCHAR,
  
  -- Workflow
  assigned_technician_id VARCHAR REFERENCES users(id),
  assigned_date TIMESTAMP,
  
  -- Diagnosis
  diagnosis_findings TEXT,
  diagnosis_date TIMESTAMP,
  
  -- Quote
  quote_data JSONB,  -- Store quote object
  quote_approved_date TIMESTAMP,
  
  -- Warranty
  warranty_id VARCHAR,
  under_warranty BOOLEAN DEFAULT FALSE,
  
  -- Billing
  invoice_id VARCHAR,
  
  -- Dates
  intake_date TIMESTAMP NOT NULL,
  estimated_completion_date TIMESTAMP,
  closed_date TIMESTAMP,
  
  -- SLA
  sla_deadline TIMESTAMP,
  sla_missed BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE repair_parts (
  id VARCHAR PRIMARY KEY,
  repair_id VARCHAR REFERENCES repairs(id),
  product_id VARCHAR,
  qty INTEGER,
  price DECIMAL,
  reserved_date TIMESTAMP,
  used_date TIMESTAMP,
  status VARCHAR  -- 'reserved', 'used', 'returned'
);

CREATE TABLE repair_qa_items (
  id VARCHAR PRIMARY KEY,
  repair_id VARCHAR REFERENCES repairs(id),
  description TEXT,
  passed BOOLEAN,
  tested_by VARCHAR,
  tested_date TIMESTAMP,
  notes TEXT
);

CREATE TABLE repair_communications (
  id VARCHAR PRIMARY KEY,
  repair_id VARCHAR REFERENCES repairs(id),
  type VARCHAR,
  channel VARCHAR,
  recipient VARCHAR,
  message TEXT,
  sent BOOLEAN,
  sent_date TIMESTAMP
);
```

---

## Testing Checklist

### Happy Path
1. ✅ Create repair job
2. ✅ Assign technician
3. ✅ Log diagnosis
4. ✅ Generate quote
5. ✅ Customer approves
6. ✅ Parts reserved
7. ✅ Repair executed
8. ✅ QA passed
9. ✅ Invoice generated
10. ✅ Device delivered
11. ✅ Job closed

### Edge Cases
- [ ] Customer rejects quote
- [ ] Parts out of stock
- [ ] QA fails → rework
- [ ] Warranty device (no charge)
- [ ] Device unrepairable
- [ ] Customer doesn't collect device

### Access Control
- [ ] Technician sees only assigned jobs
- [ ] Manager sees all jobs
- [ ] Front desk can create but not repair
- [ ] Finance sees invoicing only

---

## Next Steps

1. Review `lib/repair-types.ts` (comprehensive types already created)
2. Decide on implementation priority
3. Start with Phase 1.2 (Technician Assignment)
4. Build incrementally and test each phase
5. Deploy to production in stages

**Questions to Answer**:
- Who can assign technicians? (Manager only or self-assign?)
- Auto-send notifications or manual trigger?
- Delivery service integrated or manual tracking?
- Customer portal required in Phase 1?

---

**Document Created**: April 15, 2026
**Status**: Planning Complete, Ready for Implementation
**Priority**: HIGH - Critical for Deed Technologies repair operations
