# Repair Module - Procurement & Quote Workflow Enhancement

## Overview

Enhanced the repair module with comprehensive parts procurement workflow, quote approval/decline handling, unrepairable device management, and extended filtering options.

---

## ✅ New Features Implemented

### 1. Parts Procurement System

**When to Use:**
- Parts not available in inventory
- Special parts need to be ordered
- Waiting for supplier delivery

**Workflow:**
1. Technician diagnoses device
2. Realizes parts needed are not in stock
3. Clicks "📦 Request Parts" button
4. Fills procurement request form:
   - Part name and description
   - Part number
   - Preferred supplier
   - Quantity needed
   - Estimated cost
   - Urgency level (Low/Normal/High/Urgent)
   - Notes for procurement team
5. Submits request
6. Repair status → "Awaiting Parts"
7. Technician waits for parts to arrive
8. Once parts arrive, clicks "Update Progress" → "In Repair"

**New Status:** `awaiting_parts`
- Color: Orange `#F97316`
- Indicates repair is on hold waiting for parts
- Customer is notified about the delay

**Component:**  `components/repair/ProcurementRequest.tsx`

**Features:**
- Multi-item procurement request
- Add/remove parts dynamically
- Estimated cost calculator
- Urgency levels with visual indicators
- Total cost summary
- Notes for procurement team

**Permissions:**
- Available at "Diagnosed" or "Approved" status
- Technicians can request for their assigned repairs
- Admin/Lead techs can request for any repair

---

### 2. Quote Approval/Decline Workflow

**After Sending Quote:**

#### A. Customer Accepts Quote
- **Action:** "Approve Quote" (existing)
- **Result:** Status → "Approved"
- **Next:** Proceed with repair

#### B. Customer Declines Quote
- **Action:** "Decline Quote" button
- **Process:**
  1. Opens modal asking for decline reason
  2. Reason is logged and sent to customer
  3. Status → "Declined"
  4. Device prepared for return
  5. Customer notified to pickup device
- **Result:** No repair performed, device returned

**New Status:** `declined`
- Color: Red `#DC2626`
- Indicates customer rejected the quote
- Device ready for return pickup
- No charges apply

**Workflow:**
```
Diagnosed → Quote Generated → Quote Sent → Awaiting Approval
                                                ├─→ Approved → Repair proceeds
                                                └─→ Declined → Return to customer
```

---

### 3. Unrepairable Device Management

**When Device Cannot Be Repaired:**

**Scenarios:**
- Motherboard beyond repair
- Water damage too severe
- Parts no longer available
- Economically not viable to repair

**Action:** "Mark Unrepairable" button

**Process:**
1. Technician discovers device cannot be repaired
2. Clicks "Mark Unrepairable"
3. Enters detailed reason (sent to customer)
4. System updates status → "Unrepairable"
5. Customer receives notification
6. Device prepared for return
7. No repair charges apply

**New Status:** `unrepairable`
- Color: Dark Red `#991B1B`
- Device cannot be repaired
- Customer notified with explanation
- Free return (no charges)

**Available At:**
- Assigned (early detection)
- Diagnosed (after diagnostics)
- In Repair (discovered during repair)

**Customer Message:**
```
Hi {Customer},

After thorough diagnosis, we regret to inform you that your {Device} 
cannot be repaired due to: {Reason}

Your device is ready for return. No charges apply.

Repair: {RepairRef}

- Deed Technologies
```

---

### 4. Return to Customer

**New Status:** `returned`
- Color: Gray `#78716C`
- Device returned to customer without repair
- Available for declined/unrepairable repairs
- Closes the repair workflow

**Use Cases:**
- Quote declined by customer
- Device unrepairable
- Customer changed mind
- Parts unavailable permanently

**Action:**
- "Return to Customer" button appears for declined/unrepairable status
- Updates status to "Returned"
- Sets delivery date
- Logs return reason
- Can then close job

---

### 5. Enhanced Filters

**New Filter Options:**

| Filter | Description | Count |
|--------|-------------|-------|
| All | All repairs | Total count |
| New | Received status | Pending assignment |
| Assigned | Assigned to technician | Awaiting diagnosis |
| **Diagnosed** | Diagnosis complete | Need quote/parts |
| Awaiting Approval | Quote sent | Waiting customer response |
| **Awaiting Parts** | Parts ordered | Procurement in progress |
| In Repair | Repair in progress | Active work |
| **QC Testing** | Quality control | Final checks |
| Ready | Repair complete | Pickup ready |
| **Declined** | Quote declined | Return pending |
| **Unrepairable** | Cannot repair | Return pending |
| **Returned** | Returned to customer | Workflow complete |
| Closed | Job completed | Archived |

**Filter UI:**
- Horizontal scrollable tabs
- Badge counts for each status
- Visual active state
- Quick access to status groups

---

## Updated Status Flow

### Complete Workflow Map

```
┌─────────────┐
│  Received   │ → Device intake, ticket created
└──────┬──────┘
       ↓
┌─────────────┐
│  Assigned   │ → Technician assigned
└──────┬──────┘
       ↓
┌─────────────┐
│  Diagnosed  │ ───→ Generate Quote ──┐
└──────┬──────┘                        │
       │                               ↓
       │                    ┌──────────────────┐
       │                    │ Awaiting Approval│
       │                    └────────┬─────────┘
       │                             │
       │                   ┌─────────┴──────────┐
       │                   ↓                    ↓
       │           ┌──────────┐        ┌──────────┐
       │           │ Approved │        │ Declined │
       │           └────┬─────┘        └────┬─────┘
       │                │                   │
       │      ┌─────────┴────────┐         ↓
       │      ↓                  ↓    ┌──────────┐
       │ ┌──────────┐    ┌──────────┐│ Returned │
       │ │Awaiting  │    │In Repair ││          │
       │ │  Parts   │    │          ││          │
       │ └────┬─────┘    └────┬─────┘└────┬─────┘
       │      │               │            │
       │      └───────┬───────┘            │
       │              ↓                    │
       │         ┌─────────┐               │
       │         │   QC    │               │
       │         └────┬────┘               │
       │              ↓                    │
       │         ┌─────────┐               │
       │         │  Ready  │               │
       │         └────┬────┘               │
       │              ↓                    │
       │        ┌──────────┐               │
       │        │ Invoiced │               │
       │        └────┬─────┘               │
       │             ↓                     │
       │       ┌───────────┐               │
       │       │ Delivered │               │
       │       └─────┬─────┘               │
       │             │                     │
       │             └──────┬──────────────┘
       │                    ↓
       │              ┌─────────┐
       └──────────────│ Closed  │
                      └─────────┘
                      
       [Unrepairable] → [Returned] → [Closed]
              (Can happen at any stage before repair complete)
```

---

## Technical Implementation

### New Types (lib/repair-types.ts)

```typescript
export type RepairStatus =
  | 'received'
  | 'assigned'
  | 'diagnosed'
  | 'awaiting_approval'
  | 'approved'
  | 'awaiting_parts'        // NEW
  | 'in_repair'
  | 'qc'
  | 'ready'
  | 'invoiced'
  | 'delivered'
  | 'closed'
  | 'declined'              // NEW
  | 'unrepairable'          // NEW
  | 'returned'              // NEW
  | 'cancelled'

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
```

### New Store Functions

#### `requestProcurement(repairId, items, urgency, notes)`
**Location:** `lib/store.tsx`

- Updates repair status to "awaiting_parts"
- Logs procurement request
- Notifies procurement team (console log in dev)
- Returns control to technician when parts arrive

#### `declineQuote(repairId, reason)`
**Location:** `lib/store.tsx`

- Updates status to "declined"
- Logs decline reason
- Notifies customer for device pickup
- Prepares for return workflow

#### `markUnrepairable(repairId, reason)`
**Location:** `lib/store.tsx`

- Updates status to "unrepairable"
- Sends detailed reason to customer
- No charges apply
- Device ready for return

#### `returnToCustomer(repairId, reason)`
**Location:** `lib/store.tsx`

- Updates status to "returned"
- Sets delivery date
- Logs return reason
- Marks job as ready to close

---

## UI Components

### 1. ProcurementRequest.tsx
**Location:** `components/repair/ProcurementRequest.tsx`

**Fields:**
- Part name (required)
- Part number
- Description
- Preferred supplier
- Quantity (required)
- Estimated cost
- Urgency level (visual selector)
- Notes to procurement

**Features:**
- Add multiple parts
- Remove parts
- Total cost calculator
- Urgency indicators with colors
- Validation before submit

### 2. Updated ProgressUpdate.tsx
**Location:** `components/repair/ProgressUpdate.tsx`

**New Statuses Supported:**
- Awaiting Parts
- Declined
- Unrepairable
- Returned

**Customer Messages:**
- Updated templates for new statuses
- Clear communication about delays
- Explanation for declined/unrepairable

### 3. Decline/Unrepairable Modals
**Location:** `components/modules/Repair.tsx`

**Decline Modal:**
- Reason text area
- Warning about return
- Customer notification preview

**Unrepairable Modal:**
- Detailed reason (sent to customer)
- Clear warning
- Emphasizes "no charges"

---

## Action Buttons Reference

### Detail View Header Buttons

| Button | Status | Condition | Action |
|--------|--------|-----------|--------|
| Update Progress | Any (except closed) | Assigned tech or admin | Opens progress modal |
| Assign/Reassign | Open statuses | Admin/Lead tech only | Assign technician |
| Log Diagnosis | Assigned | Any tech | Records diagnosis |
| Generate Quote | Diagnosed | Any tech | Creates quote |
| Send Quote | DiagnosedAPI + Quote exists | Any tech | Sends to customer |
| **Request Parts** | Diagnosed/Approved | Any tech | Opens procurement modal |
| **Decline Quote** | Awaiting Approval | Admin/Lead tech | Mark quote declined |
| **Mark Unrepairable** | Assigned/Diagnosed/In Repair | Any tech | Cannot be repaired |
| Start Repair | Approved/Awaiting Parts | Assigned tech | Begin repair work |
| Complete QA | In Repair | Any tech | QC testing |
| Mark Ready | QC | Any tech | Ready for pickup |
| Create Invoice | Ready | Admin | Generate invoice |
| **Return to Customer** | Declined/Unrepairable | Any tech | Return device |
| Close Job | Delivered/Returned | Admin/Lead tech | Complete workflow |
| Delete | Any | Admin only | Remove repair |

---

## Customer Notifications

### New Notification Messages

#### Awaiting Parts
```
Hi {Customer},

We are waiting for required parts to arrive for your {Device} repair.

We will keep you updated on the progress.

Repair: {RepairRef}
Device: {DeviceName}

- Deed Technologies
```

#### Quote Declined
```
Hi {Customer},

We understand you've declined the repair quote for your {Device}.

Your device is ready for return pickup.

Repair: {RepairRef}

- Deed Technologies
```

#### Unrepairable
```
Hi {Customer},

After thorough diagnosis, we regret to inform you that your {Device}
cannot be repaired due to: {Reason}

Your device is ready for return. No charges apply.

Repair: {RepairRef}

- Deed Technologies
```

---

## Workflow Examples

### Example 1: Parts Not Available

1. Customer brings laptop
2. Tech creates repair (Status: Received)
3. Tech assigned to repair (Status: Assigned)
4. Tech diagnoses: Screen replacement needed (Status: Diagnosed)
5. Tech checks inventory: Screen not in stock
6. Tech clicks **"Request Parts"**
7. Fills form:
   - Part: "15.6\" LCD Screen"
   - Supplier: "Dell Official"
   - Qty: 1
   - Cost: 15,000 KES
   - Urgency: High
8. Submit request
9. Status → **"Awaiting Parts"**
10. Customer receives notification about delay
11. Procurement orders part
12. Part arrives after 3 days
13. Tech receives notification
14. Tech clicks "Update Progress" → "In Repair"
15. Tech installs screen
16. Continues normal workflow

### Example 2: Customer Declines Quote

1. Device diagnosed (Status: Diagnosed)
2. Quote generated: 45,000 KES
3. Quote sent to customer (Status: Awaiting Approval)
4. Customer calls: "Too expensive"
5. Admin clicks **"Decline Quote"**
6. Enters reason: "Customer found quote too expensive"
7. Submit
8. Status → **"Declined"**
9. Customer receives pickup notification
10. Device prepared for return
11. When customer comes, click **"Return to Customer"**
12. Status → **"Returned"**
13. Click "Close Job"
14. Status → **"Closed"**

### Example 3: Unrepairable Device

1. Phone brought in (Status: Received)
2. Tech assigned (Status: Assigned)
3. Tech opens phone for diagnosis
4. Discovers severe water damage to motherboard
5. Tech clicks **"Mark Unrepairable"**
6. Enters reason: "Severe water damage to motherboard. Motherboard replacement costs exceed device value."
7. Submit
8. Status → **"Unrepairable"**
9. Customer receives detailed notification
10. No charges applied
11. Customer picks up device
12. Click **"Return to Customer"**
13. Status → **"Returned"**
14. Close job

---

## Production Integration

### Procurement System Integration

**To Connect with Actual Procurement:**

1. Update `requestProcurement` function in `lib/store.tsx`
2. Create procurement order in your system:

```typescript
requestProcurement: (repairId, items, urgency, notes) => {
  // ... existing code ...

  // Create purchase order
  const purchaseOrder = {
    type: 'repair_procurement',
    repairId,
    repairRef: repair.ref,
    items: items.map(item => ({
      description: item.productName,
      partNumber: item.partNumber,
      qty: item.qty,
      estimatedCost: item.estimatedCost,
      supplier: item.supplier,
    })),
    urgency,
    notes,
    requestedBy: user.id,
    requestedDate: now(),
    status: 'pending'
  }

  // Send to procurement module
  createPurchaseOrder(purchaseOrder)

  // Or send email to procurement team
  sendEmail({
    to: 'procurement@deed.co.ke',
    subject: `Urgent: Parts Needed for Repair ${repair.ref}`,
    body: generateProcurementEmail(purchaseOrder)
  })
}
```

### Parts Arrival Notification

**When parts arrive:**
```typescript
onPartsArrived: (repairId) => {
  const repair = repairs.find(r => r.id === repairId)
  const tech = users.find(u => u.id === repair.assignedTechnicianId)

  // Notify technician
  sendNotification(tech.email, `Parts arrived for ${repair.ref}`)

  // Update repair notes
  updateRepair(repairId, {
    notes: repair.notes + `\n\nParts arrived: ${now()}`
  })
}
```

---

## Testing Checklist

### Parts Procurement
- [ ] Request parts button shows at correct statuses
- [ ] Can add multiple parts
- [ ] Can remove parts
- [ ] Total cost calculates correctly
- [ ] Urgency selector works
- [ ] Status updates to "Awaiting Parts"
- [ ] Customer receives notification
- [ ] Can progress to "In Repair" after parts arrive

### Quote Decline
- [ ] Decline button shows only at "Awaiting Approval"
- [ ] Reason is required
- [ ] Status updates to "Declined"
- [ ] Customer receives notification
- [ ] Can return device to customer
- [ ] No charges apply

### Unrepairable
- [ ] Button shows at correct statuses
- [ ] Reason is sent to customer
- [ ] Status updates to "Unrepairable"
- [ ] Customer notification clear about issue
- [ ] No charges apply
- [ ] Can return to customer

### Return Workflow
- [ ] Return button shows for declined/unrepairable
- [ ] Status updates to "Returned"
- [ ] Can close job after return
- [ ] Timeline shows correct sequence

### Filters
- [ ] All filter values show correct counts
- [ ] Filters work correctly
- [ ] New statuses appear in filters
- [ ] Badge counts update in real-time

---

## File Changes Summary

### New Files
- `components/repair/ProcurementRequest.tsx` - Parts procurement modal

### Modified Files
1. `lib/repair-types.ts` - Added new statuses and ProcurementRequest type
2. `lib/store.tsx` - Added 4 new functions
3. `components/modules/Repair.tsx` - Added buttons, modals, filters
4. `components/repair/ProgressUpdate.tsx` - Updated status flow and messages

### Total Implementation
- ~600 lines of new code
- 4 new store functions
- 1 new component
- 4 new statuses
- 13 filter options
- 8 new action buttons

---

## Benefits

### For Technicians
- ✓ Clear parts procurement workflow
- ✓ No ambiguity about missing parts
- ✓ Can mark devices unrepairable early
- ✓ Better customer communication
- ✓ Reduced back-and-forth

### For Customers
- ✓ Informed about parts delays
- ✓ Clear decline option if quote too high
- ✓ Honest communication about unrepairable devices
- ✓ No surprise charges
- ✓ Transparent process

### For Management
- ✓ Track parts procurement requests
- ✓ Monitor decline rates
- ✓ Identify unrepairable patterns
- ✓ Better inventory planning
- ✓ Improved workflow visibility

---

## Support & Documentation

**Related Documentation:**
- `REPAIR_TECHNICIAN_ACCESS.md` - Technician role and permissions
- `REPAIR_IMPLEMENTATION_COMPLETE.md` - Complete repair module docs
- `CRM_ENHANCEMENTS.md` - CRM features including customer portal

**Console Logs (Development):**
- Procurement requests logged to console
- Customer notifications previewed in console
- All ready for production SMS/WhatsApp integration

---

## Changelog

**2024-04-15 - Procurement & Workflow Enhancement**
- ✓ Parts procurement request system
- ✓ Awaiting parts status
- ✓ Quote decline workflow
- ✓ Unrepairable device handling
- ✓ Return to customer workflow
- ✓ 13 comprehensive filters
- ✓ Enhanced status flow
- ✓ Customer notifications for all scenarios
- ✓ Multi-part procurement modal
- ✓ Urgency levels for part requests
