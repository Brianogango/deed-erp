# Complete Sales Process Implementation Plan

## Executive Summary

This document outlines the comprehensive end-to-end sales process implementation for Deed ERP, covering the complete flow from Lead → Payment → After-Sales with full integration across all modules.

---

## Current Status Assessment

### ✅ Already Implemented (70%)

Based on existing codebase analysis:

1. **CRM Module** (`components/modules/CRM.tsx`)
   - ✓ Company management
   - ✓ Contact person management
   - ✓ Opportunity pipeline (7 stages)
   - ✓ Lead source tracking
   - ✓ Quote generation and versioning
   - ✓ Activity logging
   - ✓ Customer contracts
   - ✓ SLA tracking

2. **Sales Module** (`components/modules/Sales.tsx`)
   - ✓ Sales orders (quotation/order/invoice stages)
   - ✓ Product catalog integration
   - ✓ Pricing management
   - ✓ Customer selection
   - ✓ Order line items

3. **Inventory Module**
   - ✓ Product management
   - ✓ Serial number tracking
   - ✓ Stock locations
   - ✓ Stock movements
   - ✓ Bulk stock management

4. **Accounting Module**
   - ✓ Invoice generation
   - ✓ Payment recording
   - ✓ Customer/Vendor bills
   - ✓ Tax calculations

5. **Repair Module**
   - ✓ Repair orders
   - ✓ Warranty tracking
   - ✓ Parts management

### ❌ Missing Components (30%)

1. **Quote-to-Order Conversion**
   - Automatic SO creation from accepted quotes
   - Price locking during conversion

2. **Approval Workflows**
   - Multi-level approvals for discounts
   - Corporate deal approvals
   - Manager override system

3. **Inventory Reservation**
   - Stock reservation on SO creation
   - Backorder management
   - Automatic procurement triggers

4. **Delivery/Fulfillment System**
   - Picking lists
   - Delivery validation
   - Stock deduction on delivery
   - Delivery notes

5. **Payment Tracking Enhancements**
   - Payment vs Invoice reconciliation
   - Partial payment tracking
   - Credit limit enforcement
   - Payment reminders

6. **After-Sales Integration**
   - Warranty activation on delivery
   - RMA (Return Merchandise Authorization)
   - Returns processing
   - Repair-to-Sales linkage

7. **Sales Dashboard & KPIs**
   - Revenue metrics
   - Pipeline conversion
   - Sales rep performance
   - Product insights

8. **Enhanced Role Controls**
   - Sales rep restrictions
   - Manager approval workflows
   - Finance-only sections
   - Warehouse execution rights

9. **Document Linkage & Audit**
   - Complete transaction trail
   - Cannot delete (only cancel)
   - Document status tracking
   - Change history

10. **Special Scenarios**
    - Repair → Parts Sale conversion
    - Bulk orders
    - Corporate credit management

---

## Implementation Phases

### Phase 1: Core Sales Flow (Week 1)  🔴 CRITICAL

**Priority: HIGH**

#### 1.1 Quote-to-Order Conversion
**Files:**
- `lib/store.tsx` - Add `convertQuoteToSalesOrder()`
- `components/modules/CRM.tsx` - Add convert button
- `lib/sales-types.ts` - Add conversion tracking

**Implementation:**
```typescript
convertQuoteToSalesOrder(quoteId: string) => SalesOrder
```

**Logic:**
1. Validate quote status = 'accepted'
2. Check inventory availability
3. Create Sales Order with:
   - Locked pricing
   - Customer details
   - Payment terms
   - Delivery method
4. Link quote → SO
5. Update opportunity stage → 'closed_won'
6. Reserve inventory (if configured)

**Outputs:**
- Sales Order created
- Quote marked as converted
- Opportunity closed
- Audit log entry

#### 1.2 Inventory Reservation System
**Files:**
- `lib/store.tsx` - Add `reserveInventoryForSO()`
- Add reservation tracking to product state

**Implementation:**
```typescript
interface StockReservation {
  id: string
  productId: string
  qty: number
  reservedFor: 'sales_order' | 'repair' | 'transfer'
  referenceId: string
  reservedDate: string
  expiresDate: string
  status: 'reserved' | 'fulfilled' | 'cancelled'
}
```

**Logic:**
1. On SO creation:
   - Check available stock (total - reserved)
   - Create reservation records
   - Update product.reservedQty
2. On delivery:
   - Fulfill reservations
   - Deduct from actual stock
3. On cancellation:
   - Release reservations

**Controls:**
- Cannot reserve more than available
- Reservations expire after X days
- Can override to create backorder

#### 1.3 Delivery & Fulfillment Module
**Files:**
- Create `components/modules/Delivery.tsx`
- Add delivery types to `lib/sales-types.ts`
- Update `lib/store.tsx` with delivery functions

**New Types:**
```typescript
interface DeliveryNote {
  id: string
  ref: string
  salesOrderId: string
  salesOrderRef: string
  customerId: string
  customerName: string
  
  deliveryMethod: 'pickup' | 'dispatch' | 'courier'
  scheduledDate: string
  actualDate?: string
  
  items: DeliveryLine[]
  
  status: 'pending' | 'picked' | 'in_transit' | 'delivered' | 'failed'
  
  pickedBy?: string
  pickedDate?: string
  deliveredBy?: string
  deliveredTo?: string
  signature?: string
  
  address?: string
  trackingNumber?: string
  courierCompany?: string
  
  notes?: string
  createdDate: string
}

interface DeliveryLine {
  id: string
  productId: string
  productName: string
  qtyOrdered: number
  qtyDelivered: number
  serialNumbers: string[]
  location: string
}
```

**Workflow:**
1. **Create Delivery Note** from SO
2. **Picking** (warehouse):
   - Generate picking list
   - Validate items
   - Assign serial numbers
   - Confirm picking
3. **Dispatch**:
   - Select delivery method
   - Assign courier
   - Add tracking info
4. **Delivery Confirmation**:
   - Capture signature/photo
   - Update delivery status
   - Deduct stock
   - Trigger invoice

### Phase 2: Approvals & Controls (Week 2) 🟡

**Priority: HIGH**

#### 2.1 Approval Workflow System
**Files:**
- Create `lib/approvals.ts`
- Add approval UI components
- Update store with approval functions

**Implementation:**
```typescript
interface ApprovalRequest {
  id: string
  type: 'discount' | 'pricing' | 'credit' | 'deal'
  documentType: 'quote' | 'sales_order'
  documentId: string
  documentRef: string
  
  requestedBy: string
  requestedDate: string
  
  approvers: ApprovalLevel[]
  currentLevel: number
  
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  
  details: {
    reason: string
    amount?: number
    discountPercent?: number
    originalPrice?: number
    proposedPrice?: number
  }
}

interface ApprovalLevel {
  level: number
  approverId: string
  approverName: string
  approverRole: string
  decision?: 'approved' | 'rejected'
  comments?: string
  decidedDate?: string
}
```

**Approval Rules:**
```typescript
const APPROVAL_RULES = {
  discount: {
    '0-10%': [], // No approval needed
    '10-20%': ['sales_manager'],
    '20-50%': ['sales_manager', 'finance_manager'],
    '50+%': ['sales_manager', 'finance_manager', 'admin']
  },
  credit: {
    'up_to_limit': [], // Within credit limit
    'exceed_limit': ['finance_manager', 'admin']
  },
  special_pricing: ['sales_manager'],
  corporate_deal: ['sales_manager', 'admin']
}
```

**Workflow:**
1. Sales rep creates quote with discount
2. System checks approval rules
3. If approval needed:
   - Create approval request
   - Notify approvers
   - Lock quote
4. Approver reviews:
   - Approve → Next level / Final approval
   - Reject → Back to sales rep
5. Final approval:
   - Unlock quote
   - Allow sending to customer

#### 2.2 Role-Based Access Controls
**Files:**
- Update `lib/auth/access.ts`
- Add fine-grained permissions

**New Permissions:**
```typescript
interface SalesPermissions {
  canCreateQuote: boolean
  canEditQuote: boolean
  canDeleteQuote: boolean
  canApproveDiscount: boolean
  canOverridePricing: boolean
  canConvertToSO: boolean
  canCancelSO: boolean
  canModifyDeliveredSO: boolean
  canViewAllOrders: boolean
  canViewAllCustomers: boolean
  maxDiscountPercent: number
  canManageCredit: boolean
}

const ROLE_PERMISSIONS: Record<UserRole, SalesPermissions> = {
  sales_rep: {
    canCreateQuote: true,
    canEditQuote: true,
    canDeleteQuote: false,
    canApproveDiscount: false,
    canOverridePricing: false,
    canConvertToSO: true,
    canCancelSO: false,
    canModifyDeliveredSO: false,
    canViewAllOrders: false,
    canViewAllCustomers: true,
    maxDiscountPercent: 10,
    canManageCredit: false
  },
  sales_manager: {
    // ... full permissions
  }
}
```

#### 2.3 Document Controls & Audit Trail
**Files:**
- Enhance `lib/store.tsx` with state change tracking
- Add audit log UI

**Implementation:**
```typescript
interface DocumentStateChange {
  id: string
  documentType: 'quote' | 'sales_order' | 'delivery' | 'invoice'
  documentId: string
  documentRef: string
  
  fromStatus: string
  toStatus: string
  
  changedBy: string
  changedDate: string
  reason?: string
  
  fieldChanges?: {
    field: string
    oldValue: any
    newValue: any
  }[]
}
```

**Rules:**
- Cannot delete transactions (only cancel)
- All changes logged
- Cannot modify after delivery
- Cannot reduce quantity after picking
- Cannot change price after SO confirmation

### Phase 3: Payments & Finance (Week 3) 🟢

**Priority: MEDIUM**

#### 3.1 Enhanced Payment Tracking
**Files:**
- Update `components/modules/Accounting.tsx`
- Add payment reconciliation

**Implementation:**
```typescript
interface Payment {
  id: string
  ref: string
  
  customerId: string
  customerName: string
  
  amount: number
  method: 'cash' | 'bank_transfer' | 'mpesa' | 'card' | 'cheque'
  
  invoices: {
    invoiceId: string
    invoiceRef: string
    amountAllocated: number
  }[]
  
  status: 'pending' | 'cleared' | 'bounced'
  
  reference: string  // Bank ref, M-Pesa code, etc.
  receiptNumber: string
  
  receivedBy: string
  receivedDate: string
  clearedDate?: string
  
  accountingDate: string
  notes?: string
}
```

**Features:**
- Allocate payment to multiple invoices
- Track partial payments
- Payment reminders
- Overdue tracking
- Receipt generation

#### 3.2 Credit Management
**Files:**
- Add credit control functions
- Update invoice creation logic

**Implementation:**
```typescript
interface CreditLimit {
  customerId: string
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  
  overdueAmount: number
  oldestOverdueDate?: string
  
  paymentTerms: number // Days
  status: 'normal' | 'on_hold' | 'suspended'
  
  lastReviewDate: string
  nextReviewDate: string
}
```

**Controls:**
- Check credit before SO creation
- Block orders if limit exceeded
- Allow override with approval
- Auto-suspend on overdue

### Phase 4: After-Sales & Integration (Week 4) 🟢

**Priority: MEDIUM**

#### 4.1 Warranty System
**Files:**
- Enhance warranty tracking in `lib/store.tsx`
- Link to delivery

**Implementation:**
```typescript
interface WarrantyActivation {
  id: string
  productId: string
  productName: string
  serialNumber: string
  
  customerId: string
  customerName: string
  
  salesOrderId: string
  deliveryDate: string
  
  warrantyPeriodMonths: number
  startDate: string
  endDate: string
  
  status: 'active' | 'expired' | 'claimed' | 'voided'
  
  claims: WarrantyClaim[]
}

interface WarrantyClaim {
  id: string
  claimDate: string
  issueDescription: string
  repairOrderId?: string
  resolution: 'repaired' | 'replaced' | 'refunded'
  completedDate?: string
}
```

**Workflow:**
1. On delivery → Activate warranties
2. Customer brings device → Check warranty
3. If active → Free repair
4. If expired → Quote for paid repair

#### 4.2 Returns (RMA) System
**Files:**
- Create `components/modules/Returns.tsx`
- Add RMA types

**Implementation:**
```typescript
interface ReturnRequest {
  id: string
  ref: string  // RMA-2024-0001
  
  customerId: string
  customerName: string
  
  salesOrderId: string
  deliveryId: string
  originalDeliveryDate: string
  
  items: ReturnLine[]
  
  reason: 'defective' | 'wrong_item' | 'not_as_described' | 'customer_changed_mind' | 'damaged'
  reasonDetail: string
  
  requestDate: string
  approvedDate?: string
  approvedBy?: string
  
  status: 'requested' | 'approved' | 'rejected' | 'received' | 'processed'
  
  resolution: 'repair' | 'replace' | 'refund' | 'credit_note'
  
  receivedDate?: string
  receivedBy?: string
  condition?: string
  
  refundAmount?: number
  creditNoteId?: string
  replacementSOId?: string
  repairOrderId?: string
  
  notes?: string
}

interface ReturnLine {
  productId: string
  productName: string
  serialNumber?: string
  qty: number
  reason: string
}
```

**Workflow:**
1. Customer requests return
2. Review & approval
3. RMA number issued
4. Customer ships item
5. Receive & inspect
6. Process resolution:
   - Repair → Create repair order
   - Replace → Create new delivery
   - Refund → Process payment
   - Credit → Create credit note

#### 4.3 Repair-to-Sales Integration
**Files:**
- Update `components/modules/Repair.tsx`
- Add parts sale conversion

**Scenario:**
Customer brings device → Diagnosed → Needs parts

**Workflow:**
1. **Repair Created** (REP-2024-0001)
2. **Diagnosis**: Needs LCD screen
3. **Check Stock**: Screen available
4. **Convert to Sale**:
   - Create SO from repair
   - Link: Repair → SO → Invoice
5. **Issue Parts**: Deduct from inventory
6. **Continue Repair**: Use issued parts
7. **Complete**: Customer invoice includes parts + labor

**Implementation:**
```typescript
convertRepairToSale(repairId: string, items: RepairPartLine[]) {
  // 1. Create SO
  const so = createSalesOrder({
    customerId: repair.customerId,
    type: 'repair_parts',
    linkedRepairId: repairId,
    items: items
  })
  
  // 2. Create delivery (auto-pick)
  const delivery = createDelivery(so.id, {
    method: 'internal_use',
    location: 'repair_unit'
  })
  
  // 3. Update repair with parts
  updateRepair(repairId, {
    partsIssuedFromSO: so.id,
    partsUsed: items
  })
  
  // 4. Invoice includes parts + labor
}
```

### Phase 5: Dashboard & Analytics (Week 5) 🔵

**Priority: LOW (but important)

#### 5.1 Sales Dashboard
**Files:**
- Create `components/modules/SalesDashboard.tsx`
- Add KPI calculation functions

**Key Metrics:**

**Revenue Metrics:**
- Today/MTD/YTD revenue
- Revenue by category
- Revenue by sales rep
- Average order value

**Pipeline Metrics:**
- Leads → Opportunities → Won
- Conversion rates
- Pipeline value
- Average sales cycle

**Operational Metrics:**
- Pending approvals
- Orders pending delivery
- Backorders
- Stock reservations

**Financial Metrics:**
- Outstanding invoices
- Overdue amount
- Collection rate
- Credit utilization

**Product Insights:**
- Best sellers
- Slow movers
- Stock turnover
- Profit margins

#### 5.2 Sales Rep Performance
**Implementation:**
```typescript
interface RepPerformance {
  repId: string
  repName: string
  
  period: 'monthly' | 'quarterly' | 'yearly'
  
  metrics: {
    leadsCreated: number
    opportunitiesCreated: number
    quotesSent: number
    quotesAccepted: number
    
    ordersWon: number
    ordersValue: number
    
    conversionRate: number
    averageOrderValue: number
    averageSalesCycle: number // days
    
    target: number
    achieved: number
    achievementPercent: number
  }
  
  topProducts: {
    productId: string
    productName: string
    qtySold: number
    revenue: number
  }[]
}
```

### Phase 6: Testing & Refinement (Week 6) ⚪

**Priority: CRITICAL**

#### Integration Testing
- [ ] Lead → Opportunity → Quote → SO → Delivery → Invoice → Payment
- [ ] Stock reservation and deduction
- [ ] Approval workflows
- [ ] Credit limit enforcement
- [ ] Warranty activation
- [ ] Returns processing
- [ ] Repair-to-sales conversion

#### User Acceptance Testing
- [ ] Sales rep workflows
- [ ] Manager approvals
- [ ] Warehouse fulfillment
- [ ] Finance operations

#### Performance Testing
- [ ] Large order processing
- [ ] Bulk operations
- [ ] Report generation
- [ ] Dashboard load times

---

## Quick Win Implementation (Start Here) 🚀

If you want to see immediate results, implement these in order:

### Day 1: Quote-to-Order Conversion ✅
**Impact:** HIGH | **Effort:** MEDIUM

```typescript
// Add to store.tsx
convertQuoteToSalesOrder(quoteId: string) {
  const quote = quotes.find(q => q.id === quoteId)
  if (!quote || quote.status !== 'accepted') {
    showToast('Cannot convert quote', 'error')
    return
  }
  
  // Create SO
  const so = createSalesOrder({
    customerId: quote.customerId,
    customerName: quote.customerName,
    lines: quote.lines,
    total: quote.total,
    linkedQuoteId: quoteId,
    status: 'confirmed'
  })
  
  // Update quote
  updateQuote(quoteId, { 
    status: 'converted',
    convertedToSOId: so.id 
  })
  
  // Close opportunity
  if (quote.opportunityId) {
    updateOpportunity(quote.opportunityId, { 
      stage: 'closed_won',
      actualValue: quote.total 
    })
  }
  
  showToast(`Sales Order ${so.ref} created from Quote ${quote.ref}`)
  return so
}
```

### Day 2: Inventory Reservation ✅
**Impact:** HIGH | **Effort:** MEDIUM

### Day 3: Delivery Module ✅
**Impact:** HIGH | **Effort:** HIGH

### Day 4: Approval Workflow ✅
**Impact:** MEDIUM | **Effort:** HIGH

### Day 5: Payment Tracking ✅
**Impact:** MEDIUM | **Effort:** LOW

---

## Database Schema Requirements

### New Tables Needed

```sql
-- Stock Reservations
CREATE TABLE stock_reservations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  reserved_for TEXT NOT NULL, -- 'sales_order', 'repair', etc.
  reference_id TEXT NOT NULL,
  reserved_date TEXT NOT NULL,
  expires_date TEXT,
  status TEXT NOT NULL, -- 'reserved', 'fulfilled', 'cancelled'
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Delivery Notes
CREATE TABLE delivery_notes (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  sales_order_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  delivery_method TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  actual_date TEXT,
  status TEXT NOT NULL,
  created_date TEXT NOT NULL,
  FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id)
);

-- Approval Requests
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  document_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  status TEXT NOT NULL,
  current_level INTEGER DEFAULT 0,
  created_date TEXT NOT NULL
);

-- Warranty Activations
CREATE TABLE warranty_activations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  sales_order_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Return Requests (RMA)
CREATE TABLE return_requests (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  customer_id TEXT NOT NULL,
  sales_order_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  request_date TEXT NOT NULL,
  resolution TEXT,
  FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id)
);
```

---

## Migration Strategy

### Option 1: Incremental (Recommended)
Implement one phase at a time while system is live:
- ✅ Minimal disruption
- ✅ Test each feature thoroughly
- ✅ User training per phase
- ⚠️ Longer timeline

### Option 2: Big Bang
Implement everything, then switch:
- ✅ Faster overall
- ✅ Launch with complete system
- ⚠️ Higher risk
- ⚠️ Complex testing

### Recommended Approach:
1. Week 1: Core sales flow (Quote→SO→Delivery)
2. Week 2: Test with real orders
3. Week 3: Add approvals & controls
4. Week 4: Payments & after-sales
5. Week 5: Dashboard & reports
6. Week 6: Training & go-live

---

## Success Metrics

### KPIs to Track

**Operational:**
- Order processing time
- Delivery accuracy rate
- Stock-out incidence
- Backorder rate

**Financial:**
- Revenue growth
- Invoice aging
- Collection period
- Credit losses

**Customer:**
- Quote acceptance rate
- Delivery satisfaction
- Return rate
- Repeat customer rate

**Team:**
- Sales rep productivity
- Approval turnaround time
- Order errors
- Customer complaints

---

## Next Steps

1. **Review this document** with stakeholders
2. **Approve implementation phases**
3. **Assign resources** (developers, testers)
4. **Set timeline** (6 weeks recommended)
5. **Start Phase 1** implementation

**Let me know which phase you'd like to start with, and I'll begin the implementation immediately!**

---

## Support & Training

### Documentation Needed
- [ ] User manual (Sales Rep)
- [ ] Manager approval guide
- [ ] Warehouse fulfillment guide
- [ ] Finance operations guide

### Training Sessions
- [ ] Sales team (2 hours)
- [ ] Warehouse team (1 hour)
- [ ] Finance team (1 hour)
- [ ] Management dashboard (30 min)

### Support Plan
- Week 1-2: Daily check-ins
- Week 3-4: Every other day
- Week 5-6: As needed
- Ongoing: Email/ticket support

---

**Document Version:** 1.0
**Created:** 2024-04-16
**Status:** Ready for Implementation
**Estimated Timeline:** 6 weeks
**Estimated Effort:** 240 hours
