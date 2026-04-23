# Comprehensive Repair Module - Implementation Complete ✓

**Deed Technologies ERP**  
**Date**: April 15, 2026, 15:32 EAT  
**Status**: Production Ready

---

## Implementation Summary

Implemented a complete end-to-end repair workflow system with 12-stage lifecycle tracking, technician-level access control, quote approval flow, automatic part reservation, QA testing gates, and warranty integration.

---

## ✅ Completed Features

### 1. Complete 12-Stage Workflow

**Old Flow** (6 states):
```
draft → confirmed → under_repair → done → invoiced → cancelled
```

**New Flow** (12 states):
```
received → assigned → diagnosed → awaiting_approval → approved 
→ in_repair → qc → ready → invoiced → delivered → closed → cancelled
```

**Status Definitions**:
- `received` - Job created, awaiting technician assignment
- `assigned` - Technician assigned, ready for diagnosis
- `diagnosed` - Diagnosis complete, findings logged
- `awaiting_approval` - Quote sent to customer, waiting for response
- `approved` - Quote approved, parts reserved, ready to start
- `in_repair` - Repair work in progress
- `qc` - Quality control testing phase
- `ready` - QA passed, device ready for pickup
- `invoiced` - Invoice generated (if not warranty)
- `delivered` - Device handed over to customer
- `closed` - Job completed and closed
- `cancelled` - Job cancelled at any stage

### 2. Enhanced RepairOrder Structure

**New Fields Added**:
```typescript
// Customer Details
customerPhone: string
customerEmail?: string

// Intake
intakeChannel: 'walk_in' | 'website' | 'whatsapp' | 'call' | 'email'
intakeDate: string
intakeNotes: string
issueDescription: string
accessories: { name: string; received: boolean; notes?: string }[]
deviceCondition: 'good' | 'fair' | 'poor' | 'damaged'

// Technician Assignment
assignedTechnicianId?: string
assignedTechnicianName?: string
assignedDate?: string

// Diagnosis
diagnosis?: {
  findings: string
  faultDescription: string
  recommendedAction: string
  estimatedHours: number
  diagnosedBy: string
  diagnosedDate: string
}

// Quotation
quote?: {
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

// Quality Control
qcItems: RepairQAItem[]
qcPassedDate?: string
qcApprovedBy?: string

// Delivery/Pickup
deliveryMethod?: 'pickup' | 'delivery' | 'courier'
deliveryScheduledDate?: string
deliveryActualDate?: string
deliveryAddress?: string
deliveryRecipient?: string

// Parts Tracking (Enhanced)
partsUsed: {
  productId: string
  productName: string
  qty: number
  price: number
  reservedDate?: string      // When part was reserved
  usedDate?: string          // When part was consumed
}[]

// Costs
laborCost: number
logisticsCost: number        // NEW: Delivery/pickup fees
total: number

// SLA Tracking
slaDeadline?: string
slaMissed: boolean
estimatedCompletionDate?: string

// Audit Trail
createdBy: string
createdDate: string
closedDate?: string
```

### 3. Technician Assignment & Access Control

**Implementation**: `lib/store.tsx:2055-2071`

**Features**:
- ✅ Assign specific technician to repair job
- ✅ Auto-populate technician name in UI
- ✅ Track assignment date
- ✅ Role-based visibility:
  - `super_admin` / `admin` → See all repairs
  - `repair_tech` → See only assigned repairs
  - Other roles → See all (for coordination)

**Methods Added**:
```typescript
assignTechnicianToRepair(repairId: string, technicianId: string)
canViewRepair(repairId: string): boolean
getVisibleRepairs(): RepairOrder[]
```

### 4. Diagnosis Logging

**Implementation**: `lib/store.tsx:2073-2095`

**Workflow**:
1. Technician opens device
2. Logs findings, fault description, recommended action
3. Estimates repair hours
4. System timestamps and attributes diagnosis
5. Status → `diagnosed`

**Method**:
```typescript
logDiagnosis(repairId: string, {
  findings: string
  faultDescription: string
  recommendedAction: string
  estimatedHours: number
})
```

### 5. Quote Generation & Approval Flow

**Implementation**: `lib/store.tsx:2097-2229`

**Workflow**:
1. After diagnosis → Generate quote
2. Quote includes:
   - Parts (with product IDs)
   - Labor (per estimated hours or flat rate)
   - Logistics (delivery fees if applicable)
3. Quote sent to customer (email/WhatsApp/portal)
4. Status → `awaiting_approval`
5. Customer approves/rejects:
   - **Approved** → Parts auto-reserved from inventory
   - **Rejected** → Job cancelled

**Key Features**:
- ✅ Automatic stock reservation on approval
- ✅ Validates sufficient inventory before approval
- ✅ Marks serials as "assigned" to repair
- ✅ Quote expiry tracking (7-day default)
- ✅ Rejection reason logging

**Methods**:
```typescript
generateRepairQuote(repairId, parts, laborCost, logisticsCost)
sendQuoteToCustomer(repairId)
approveRepairQuote(repairId, approved, reason?)
```

### 6. Stock Reservation System

**Implementation**: Within `approveRepairQuote` flow

**Critical Logic**:
```typescript
// On quote approval:
1. Check inventory availability for each part
2. Validate serialized vs bulk stock
3. If insufficient → Block approval
4. If sufficient → Reserve parts:
   - Mark serials as 'assigned' with repairId
   - Track reservedDate
5. Parts locked from other repairs

// On QA completion:
1. Consume reserved parts
2. Deduct from stock
3. Update stock moves
4. Mark usedDate
```

**Stock Validation**:
- Serialized products: Check available serials count
- Bulk products: Check total available across:
  - Warehouse
  - Shop
  - Repair Unit

### 7. Repair Execution

**Implementation**: `lib/store.tsx:2231-2242`

**Flow**:
- Quote approved → `approved` status
- Technician starts work → `in_repair` status
- System tracks `repairStartDate`

**Method**:
```typescript
startRepair(repairId: string)
```

### 8. Quality Control (QA) System

**Implementation**: `lib/store.tsx:2244-2315`

**Workflow**:
1. Repair completed → Add QA checklist
2. Default QA items:
   - Device powers on correctly
   - All functions tested and working
   - No physical damage or defects
   - Device cleaned and ready
3. Technician/QA person tests each item
4. Mark pass/fail with notes
5. **All items must pass** to proceed
6. Pass → `ready` status + consume reserved parts
7. Fail → Remains in `qc` status for rework

**Key Features**:
- ✅ QA blocking gate (can't mark ready if QA fails)
- ✅ Part consumption happens only after QA pass
- ✅ Auto-creates stock moves when parts consumed
- ✅ Tracks QA approver and date

**Methods**:
```typescript
addRepairQAItem(repairId: string, description: string)
completeRepairQA(repairId: string, qaResults: Array<{
  itemId: string
  passed: boolean
  notes?: string
}>)
```

### 9. Billing Integration with Warranty Logic

**Implementation**: `lib/store.tsx:2327-2388`

**Warranty Handling**:
```typescript
if (repair.underWarranty) {
  // No invoice generated
  // Total = 0
  // Parts and labor = FREE
  // Optional: Track claim to OEM/supplier
} else {
  // Generate invoice with:
  // - Parts
  // - Labor
  // - Logistics
  createInvoiceFromRepair(repairId)
}
```

**Invoice Generation**:
- Pulls parts from `partsUsed[]`
- Adds labor as single line item
- Adds logistics if applicable
- Applies 16% VAT
- Creates `customer_invoice` with `posted` status
- Links invoice to repair via `invoiceId`
- Updates repair status → `invoiced`

**Method**:
```typescript
createInvoiceFromRepair(repairId: string): Invoice | null
```

### 10. Delivery/Pickup Tracking

**Implementation**: `lib/store.tsx:2317-2326, 2390-2414`

**Workflow**:
1. QA passed → Device `ready`
2. Schedule delivery/pickup:
   - Method: pickup / delivery / courier
   - Scheduled date
   - Address (if delivery)
3. On handover → `delivered` status
4. Record recipient details
5. Ready for closure

**Methods**:
```typescript
scheduleDelivery(repairId, method, scheduledDate, address?)
deliverRepair(repairId, recipientName, recipientPhone)
```

### 11. Job Closure

**Implementation**: `lib/store.tsx:2416-2436`

**Validation**:
- Status must be `delivered` or `invoiced`
- If not warranty → Invoice must exist
- Payment confirmed (manual check for now)

**Effect**:
- Status → `closed`
- Records `closedDate`
- Job archived from active views

**Method**:
```typescript
closeRepairJob(repairId: string)
```

### 12. Comprehensive Repair UI

**File**: `components/modules/Repair.tsx` (completely rewritten, 1190 lines)

**Views**:

#### List View
- Stats cards: Total, Pending, In Progress, Awaiting Approval, Ready
- Status filter dropdown (all 12+ statuses)
- Repair jobs table with:
  - REF, Status badge, Warranty badge
  - Customer, Device, Serial, Issue preview
  - Technician assignment
  - Intake date, Estimated completion
  - Total cost or "FREE" for warranty
- Click repair → Opens detail view

#### Detail View
**Layout**: Two-column responsive design

**Left Column**:
1. **Job Information Card**
   - Customer details (name, phone, email)
   - Device details (name, serial, condition)
   - Intake info (date, channel, created by)
   - Assigned technician (with assign button if unassigned)

2. **Issue Description & Accessories**
   - Full issue description
   - Accessories received list with checkmarks
   - Intake notes

3. **Diagnosis Card** (after assignment)
   - Diagnosed by, date, estimated hours
   - Findings, fault description, recommended action
   - "Log Diagnosis" button (if not yet diagnosed)

4. **Quotation Card** (after diagnosis)
   - Quote lines (parts, labor, logistics)
   - Total with tax
   - Reserved indicator on parts
   - Approval/rejection status and date
   - Actions: Send to Customer, Approve, Reject

5. **QA Checklist Card** (during/after repair)
   - Checklist items with pass/fail checkboxes
   - Notes field per item
   - "Add QA Items" button
   - "Complete QA" button
   - QA pass indicator with approver

**Right Column**:
1. **Workflow Actions Panel**
   - Context-sensitive action buttons based on current status:
     - Assign Technician (received)
     - Log Diagnosis (assigned)
     - Generate Quote (diagnosed)
     - Send/Approve/Reject Quote (awaiting_approval)
     - Start Repair (approved)
     - Add/Complete QA (in_repair)
     - Generate Invoice (ready, non-warranty)
     - Schedule Delivery (ready/invoiced)
     - Mark Delivered (scheduled)
     - Close Job (delivered)
     - Check Warranty (received, if serial provided)

2. **Warranty Info Panel** (if warranty applies)
   - Warranty ID
   - "No charges to customer" notice
   - Parts and labor covered indicator

3. **Billing Summary Panel**
   - Parts total
   - Labor cost
   - Logistics cost
   - Grand total (or "FREE (Warranty)")
   - Invoice reference (if generated)

4. **Delivery Details Panel** (if scheduled)
   - Delivery method
   - Scheduled date
   - Delivery address (if applicable)
   - Actual delivery date
   - Recipient info

**Modals**:
1. **Create Repair Job**
   - Customer selector
   - Intake channel
   - Device/product name
   - Serial number
   - Device condition
   - Accessories (comma-separated)
   - Issue description

2. **Assign Technician**
   - Technician selector (filters users by role)

3. **Log Diagnosis**
   - Findings (required)
   - Fault description (required)
   - Recommended action
   - Estimated hours

4. **Generate Quote**
   - Parts grid (product selector, qty, price)
   - Add/remove part lines
   - Labor cost
   - Logistics cost
   - Live total calculation with tax

5. **Complete QA**
   - Checkbox grid for all QA items
   - Notes field per item
   - Real-time pass/fail validation

6. **Schedule Delivery**
   - Method selector (pickup/delivery/courier)
   - Scheduled date
   - Delivery address (if not pickup)

---

## Key Implementation Details

### Role-Based Access Control

**File**: `lib/store.tsx:2438-2459`

```typescript
canViewRepair(repairId: string): boolean {
  // Super admin / admin → All repairs
  // Repair tech → Only assigned repairs
  // Others → All repairs (for coordination)
}

getVisibleRepairs(): RepairOrder[] {
  // Automatically filters repair list based on role
}
```

**Usage**: Repair module automatically shows only relevant jobs for technicians.

### Part Reservation Logic

**Files**:
- Quote approval: `lib/store.tsx:2152-2227`
- Part consumption: `lib/store.tsx:2267-2304`

**Flow**:
```
1. Quote approved
   ↓
2. Check stock availability
   - If serialized: Count available serials
   - If bulk: Sum warehouse + shop + repair_unit
   ↓
3. If insufficient → Block approval
   ↓
4. If sufficient → Reserve:
   - Mark serials as 'assigned' with repairId
   - Track reservedDate
   - Update quote lines: reserved = true
   ↓
5. QA passes
   ↓
6. Consume parts:
   - Deduct from stock
   - Update stock moves
   - Mark usedDate
   - Release serial (no longer assigned)
```

**Critical**: Parts are **reserved but not consumed** until QA passes.

### Warranty Integration

**Files**:
- Warranty check: `lib/store.tsx:2042-2053`
- Invoice generation: `lib/store.tsx:2327-2388`

**Logic**:
```typescript
if (repair.underWarranty) {
  // No invoice to customer
  // laborCost and total set to 0
  // Parts tracked but not charged
  // Badge shows "WARRANTY REPAIR"
} else {
  // Normal billing flow
  // Generate invoice from repair
}
```

**Warranty Badge**: Shows prominently in UI when applicable.

### Stock Move Tracking

All part consumption creates audit trail:
```typescript
addMove(
  productId,
  productName,
  qty,
  'out',                    // Stock out
  `Repair ${repair.ref}`,   // Reference
  repair.ref,               // Document ref
  'repair_unit',            // From repair inventory
  undefined,                // To customer (consumed)
  serialNumbers
)
```

### Invoice Generation

**File**: `lib/store.tsx:2327-2388`

**Invoice Structure**:
```
Line 1: Part: {ProductName}      Qty × Price
Line 2: Part: {ProductName}      Qty × Price
...
Line N: Labor & Service Charges  1 × LaborCost
Line N+1: Delivery Service       1 × LogisticsCost (if applicable)
---
Tax (16%)
Total
```

**Linked**: Invoice references repair via notes, repair references invoice via `invoiceId`.

---

## Files Modified/Created

### Core Logic
1. ✅ `lib/store.tsx` - Complete workflow implementation (2554 lines total)
   - New RepairOrder interface with 50+ fields
   - Expanded RepairStatus type (12 states)
   - 18 new repair workflow methods
   - Role-based access control functions
   - Part reservation/consumption logic
   - Invoice generation with warranty awareness

2. ✅ `lib/repair-types.ts` - Comprehensive type definitions (NEW)
   - All repair-related types documented
   - Permission matrix definitions
   - Communication types
   - QA structures

### UI Components
3. ✅ `components/modules/Repair.tsx` - Complete UI rewrite (1190 lines)
   - List view with filtering
   - Detail view with two-column layout
   - 6 specialized modals
   - Contextual action buttons
   - Status-aware rendering

4. ✅ `components/layout/Sidebar.tsx` - Updated badge count logic
   - Now counts: received + assigned + diagnosed + awaiting_approval + approved + in_repair + qc + ready

5. ✅ `components/modules/Dashboard.tsx` - Updated repair count
   - Same logic as Sidebar for consistency

6. ✅ `components/ui/index.tsx` - Added repair status colors
   - All 12 status badges now have proper colors

### Seed Data
7. ✅ `lib/store.tsx:980-1097` - Updated seed repairs
   - rep1: In-repair job with full diagnosis, quote, QA items
   - rep2: Diagnosed job awaiting quote generation

---

## Usage Guide

### Creating a New Repair Job

1. Navigate to Repairs module
2. Click "+ New Repair Job"
3. Fill intake form:
   - Select customer
   - Choose intake channel (walk-in, website, etc.)
   - Enter device name
   - Enter serial (optional but needed for warranty check)
   - Select device condition
   - List accessories received
   - Describe the issue
4. Click "Create Repair Job"
5. Job created with status `received`

### Complete Workflow Example

**Scenario**: Customer brings MacBook with battery issue

```
Step 1: INTAKE
- Create job → REP/0040
- Status: received
- System assigns REF, logs intake

Step 2: ASSIGNMENT
- Manager assigns to technician "Alice"
- Status: assigned
- Alice can now see this job in her list

Step 3: DIAGNOSIS
- Alice opens device, inspects
- Logs diagnosis:
  - Findings: "Battery swelling, 3 cells damaged"
  - Fault: "Manufacturing defect in battery pack"
  - Action: "Replace entire battery assembly"
  - Hours: 3
- Status: diagnosed

Step 4: QUOTE GENERATION
- Alice/Manager generates quote:
  - Part: MacBook Battery (1 × KES 15,000)
  - Labor: Service charge (1 × KES 7,500)
  - Logistics: none
  - Total: KES 26,100 (incl. VAT)
- Status: awaiting_approval

Step 5: CUSTOMER COMMUNICATION
- Quote sent via email/WhatsApp
- Customer reviews quote
- Valid for 7 days

Step 6: APPROVAL
- Customer approves quote (via portal/call/WhatsApp)
- System checks inventory:
  - MacBook Battery: 2 available in warehouse
  - Sufficient stock ✓
- Parts reserved:
  - Serial BATT-MB-001 marked as 'assigned' to REP/0040
  - reservedDate: 2026-04-15
- Status: approved

Step 7: REPAIR EXECUTION
- Alice starts repair work
- Status: in_repair
- repairStartDate: 2026-04-15
- Parts physically used but not yet consumed from inventory

Step 8: QUALITY CONTROL
- Repair completed
- QA checklist appears:
  □ Device powers on correctly
  □ All functions tested
  □ No physical damage
  □ Device cleaned
- Alice tests each item, marks as passed
- Status: qc

Step 9: QA COMPLETION
- All items passed
- System:
  - Consumes reserved part from inventory
  - Deducts stock: MacBook Battery (1 unit)
  - Creates stock move: OUT from repair_unit
  - Marks usedDate: 2026-04-15
  - Releases serial: BATT-MB-001 status → available, location → repair_unit
- Status: ready
- Customer notified "Device ready for pickup"

Step 10: INVOICING
- Generate invoice INV/0090:
  - Part: MacBook Battery × 1 = KES 15,000
  - Labor: Service charge × 1 = KES 7,500
  - Tax (16%) = KES 3,600
  - Total = KES 26,100
- Status: invoiced
- Payment pending

Step 11: DELIVERY/PICKUP
- Customer comes to collect
- Schedule: pickup, today
- Hand over device to "John Kamau" (+254712345678)
- Status: delivered

Step 12: CLOSURE
- Validate: Payment received (manual check)
- Close job
- Status: closed
- closedDate: 2026-04-15
- Job archived
```

### Warranty Repair Flow

**Scenario**: Device under active warranty

```
Step 1-2: Intake + Assignment (same)

Step 3: WARRANTY CHECK
- Click "Check Warranty Status"
- System finds active warranty WAR/0010
- Auto-sets:
  - underWarranty: true
  - warrantyId: WAR/0010
  - laborCost: 0
  - total: 0
- Badge shows "WARRANTY REPAIR"

Step 4-7: Diagnosis + Approval (simplified)
- No quote generation needed
- Parts still reserved (for tracking)
- Customer notified "Covered under warranty"
- Direct to repair execution

Step 8-9: QA (same as non-warranty)

Step 10: NO INVOICING
- Skip invoice generation
- Status: ready (bypasses invoiced)

Step 11-12: Delivery + Closure (same)
```

---

## Testing Checklist

### ✅ Happy Path Tested
- [x] Create repair job with intake details
- [x] Assign technician
- [x] Log diagnosis
- [x] Generate quote with parts/labor
- [x] Approve quote → Parts reserved
- [x] Start repair
- [x] Add QA checklist
- [x] Complete QA (all pass) → Parts consumed
- [x] Generate invoice
- [x] Schedule delivery
- [x] Mark delivered
- [x] Close job

### ✅ Warranty Path Tested
- [x] Create repair with serial
- [x] Check warranty → Found
- [x] Warranty applied → Cost = 0
- [x] Repair executed
- [x] QA passed
- [x] Skip invoicing
- [x] Deliver + close

### ✅ Access Control Tested
- [x] Super admin sees all repairs
- [x] Repair tech sees only assigned repairs
- [x] Repair tech cannot progress unassigned repairs

### ✅ Stock Integration Tested
- [x] Quote approval blocks if parts unavailable
- [x] Parts reserved on approval
- [x] Parts consumed on QA pass
- [x] Stock moves created correctly

### ✅ Error Handling
- [x] Insufficient stock → Approval blocked
- [x] QA fail → Remains in QC status
- [x] Close without invoice → Blocked
- [x] Warranty repair → No invoice

---

## Build Verification

```bash
npm run build
```

**Result**: ✅ Compiled successfully

**Route Size**: 165 kB (app page with full repair module)

**Warnings**: SQLite experimental feature warnings (expected, non-blocking)

---

## Next Enhancement Opportunities

### Phase 4: Communication Automation
**Priority**: Medium

**Implementation**:
```typescript
// Trigger notifications at workflow milestones
sendRepairNotification(repairId: string, type: NotificationType)

// Notification types:
- 'intake_confirmation'    → Job created
- 'diagnosis_update'       → Diagnosis complete
- 'quote_sent'            → Quote ready for approval
- 'approval_received'     → Customer approved
- 'progress_update'       → Repair in progress
- 'ready_notification'    → Ready for pickup
- 'delivery_confirmation' → Device delivered

// Channels:
- Email (if customer.email exists)
- SMS (if SMS provider configured)
- WhatsApp (if WhatsApp Business API integrated)
- Customer portal notification
```

**Files to Create**:
- `lib/communications/repair-notifications.ts`
- `lib/communications/templates.ts`
- `lib/communications/channels.ts`

### Phase 5: SLA Tracking
**Priority**: Medium

**Implementation**:
```typescript
// At job creation
slaDeadline = calculateSLA(repairType, priority, deviceType)

// Example:
- Laptop: 48 hours
- Printer: 24 hours
- Priority customer: -50% time
- Warranty: Same SLA

// Monitor
slaMissed = currentTime > slaDeadline && status !== 'closed'

// Alerts
if (hoursToDeadline < 4) {
  notifyRepairManager(repair)
  flagInDashboard(repair)
}
```

### Phase 6: Customer Portal
**Priority**: Low (Phase 1-3 must be stable first)

**Features**:
- Track repair status live
- View quote and approve online
- Upload device photos during intake
- Download invoice
- Rate service after completion

**Stack**: Next.js public pages + JWT tokens

### Phase 7: Technician Metrics
**Priority**: Low

**Track**:
- Jobs completed per technician
- Average repair time
- QA pass rate
- Customer satisfaction (if feedback collected)
- Revenue generated

**UI**: Technician performance dashboard in Repair module

---

## Database Migration (When Moving to Prod DB)

```sql
CREATE TABLE repairs (
  id VARCHAR PRIMARY KEY,
  ref VARCHAR UNIQUE NOT NULL,
  status VARCHAR NOT NULL,
  
  -- Customer
  customer_id VARCHAR REFERENCES contacts(id),
  customer_name VARCHAR,
  customer_phone VARCHAR,
  customer_email VARCHAR,
  
  -- Device
  product_id VARCHAR,
  product_name VARCHAR NOT NULL,
  serial_number VARCHAR,
  serial_id VARCHAR,
  device_condition VARCHAR,
  
  -- Intake
  intake_channel VARCHAR NOT NULL,
  intake_date DATE NOT NULL,
  intake_notes TEXT,
  issue_description TEXT NOT NULL,
  accessories JSONB,
  
  -- Warranty
  warranty_id VARCHAR,
  under_warranty BOOLEAN DEFAULT FALSE,
  warranty_claim_id VARCHAR,
  
  -- Assignment
  assigned_technician_id VARCHAR REFERENCES users(id),
  assigned_technician_name VARCHAR,
  assigned_date DATE,
  
  -- Diagnosis
  diagnosis_findings TEXT,
  diagnosis_fault_description TEXT,
  diagnosis_recommended_action TEXT,
  diagnosis_estimated_hours DECIMAL,
  diagnosed_by VARCHAR,
  diagnosed_date DATE,
  
  -- Quote
  quote_data JSONB,
  quote_approval_deadline DATE,
  
  -- Repair Execution
  repair_start_date DATE,
  repair_completed_date DATE,
  
  -- Costs
  labor_cost DECIMAL DEFAULT 0,
  logistics_cost DECIMAL DEFAULT 0,
  total DECIMAL DEFAULT 0,
  
  -- QA
  qc_passed_date DATE,
  qc_approved_by VARCHAR,
  
  -- Billing
  invoice_id VARCHAR,
  invoice_date DATE,
  
  -- Delivery
  delivery_method VARCHAR,
  delivery_scheduled_date DATE,
  delivery_actual_date DATE,
  delivery_address TEXT,
  delivery_recipient VARCHAR,
  delivery_notes TEXT,
  
  -- SLA
  sla_deadline TIMESTAMP,
  sla_missed BOOLEAN DEFAULT FALSE,
  estimated_completion_date DATE,
  
  -- Metadata
  created_by VARCHAR NOT NULL,
  created_date DATE NOT NULL,
  closed_date DATE,
  notes TEXT,
  
  -- Legacy
  intake_source VARCHAR,
  linked_employee_id VARCHAR,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_repairs_status ON repairs(status);
CREATE INDEX idx_repairs_technician ON repairs(assigned_technician_id);
CREATE INDEX idx_repairs_customer ON repairs(customer_id);
CREATE INDEX idx_repairs_serial ON repairs(serial_number);

CREATE TABLE repair_parts (
  id VARCHAR PRIMARY KEY,
  repair_id VARCHAR REFERENCES repairs(id) ON DELETE CASCADE,
  product_id VARCHAR NOT NULL,
  product_name VARCHAR NOT NULL,
  qty INTEGER NOT NULL,
  price DECIMAL NOT NULL,
  serial_id VARCHAR,
  reserved_date DATE,
  used_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE repair_qa_items (
  id VARCHAR PRIMARY KEY,
  repair_id VARCHAR REFERENCES repairs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  passed BOOLEAN DEFAULT FALSE,
  tested_by VARCHAR,
  tested_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints (Future Backend Integration)

When moving repair logic to backend APIs:

```
POST   /api/repairs              → Create repair job
GET    /api/repairs              → List visible repairs
GET    /api/repairs/:id          → Get repair details
PATCH  /api/repairs/:id          → Update repair
DELETE /api/repairs/:id          → Delete repair

POST   /api/repairs/:id/assign        → Assign technician
POST   /api/repairs/:id/diagnose      → Log diagnosis
POST   /api/repairs/:id/quote         → Generate quote
POST   /api/repairs/:id/quote/send    → Send quote
POST   /api/repairs/:id/quote/approve → Approve/reject quote
POST   /api/repairs/:id/start         → Start repair
POST   /api/repairs/:id/qa            → Complete QA
POST   /api/repairs/:id/invoice       → Generate invoice
POST   /api/repairs/:id/schedule      → Schedule delivery
POST   /api/repairs/:id/deliver       → Mark delivered
POST   /api/repairs/:id/close         → Close job

GET    /api/repairs/:id/warranty      → Check warranty
```

**Authorization**: Use `requirePermission(...)` pattern from auth system.

---

## Performance Notes

- Repair list filtered by `getVisibleRepairs()` at source (efficient)
- Part reservation validates stock BEFORE committing
- QA gate prevents premature part consumption
- All workflow actions create audit log entries
- Status transitions tracked with timestamps

---

## Known Limitations (To Address in Production)

1. **No SMS/Email Integration**: Notifications are logged but not sent
2. **Manual Payment Confirmation**: Closure requires manual check that invoice is paid
3. **No OEM Warranty Claims**: Warranty covers cost but doesn't track claims to suppliers
4. **No SLA Auto-Calculation**: SLA deadline must be set manually
5. **No Customer Portal**: Quote approval requires phone/email confirmation
6. **No Photo Upload**: Device condition photos not supported yet
7. **No Repair History**: No view of past repairs for a specific serial/device

---

## Production Deployment Checklist

- [ ] Move seed data to database initialization script
- [ ] Configure email provider (SendGrid/AWS SES)
- [ ] Configure SMS provider (Africa's Talking/Twilio)
- [ ] Set up WhatsApp Business API
- [ ] Define SLA rules per device type
- [ ] Create customer portal routes
- [ ] Add device photo upload (S3/Cloudinary)
- [ ] Build repair history view by serial number
- [ ] Set up automated report generation
- [ ] Configure backup for repair data
- [ ] Add repair approval workflow (if manager sign-off needed)
- [ ] Implement part requisition from warehouse to repair unit
- [ ] Add technician performance dashboards
- [ ] Create repair analytics (time-to-resolution, cost analysis)

---

## Success Metrics

**Implemented**:
✅ 12-stage workflow lifecycle  
✅ Technician-level access control  
✅ Automatic stock reservation  
✅ QA blocking gate  
✅ Warranty cost bypass  
✅ Comprehensive audit trail  
✅ Invoice generation  
✅ Delivery tracking  
✅ 18 workflow action methods  
✅ Complete UI with 6 modals  
✅ Role-based repair visibility  
✅ Build verification passed  

**Lines of Code**:
- Core logic: ~500 new lines in store.tsx
- UI component: 1190 lines (complete rewrite)
- Type definitions: 200 lines

**Build Status**: ✅ Production ready

---

**Document Generated**: April 15, 2026, 15:32 EAT  
**Implementation**: Complete  
**Status**: READY FOR PRODUCTION TESTING
