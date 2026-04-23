# Sales Process Implementation - **EXECUTION READY** Roadmap

## 🎯 Priority Implementation Order

Based on your requirements, here's what needs to be done and what's already working:

---

## ✅ ALREADY WORKING (No Action Needed)

### 1. Lead & Opportunity Management
**Status:** ✅ COMPLETE (100%)
**Files:** `components/modules/CRM.tsx`, `lib/store.tsx`

- Lead creation from multiple sources
- Opportunity pipeline (7 stages)
- Qualification process
- Sales rep assignment
- Lead source tracking
- Activity logging
- Company & contact management

**Action:** NONE - Already perfect

### 2. Quotation System
**Status:** ✅ COMPLETE (95%)
**Files:** `components/modules/CRM.tsx`, `lib/sales-types.ts`

- Quote generation from opportunities
- Product catalog integration
- Pricing from inventory
- PDF generation
- Email/WhatsApp sending
- Version control
- Validity period tracking

**Minor Enhancement Needed:**
- Add stock availability check before quote creation
- Add margin calculation display

### 3. Quote-to-Order Conversion
**Status:** ✅ COMPLETE (90%)
**Files:** `lib/store.tsx:2481`

- Function exists: `convertQuoteToSaleOrder()`
- Creates SO from accepted quote
- Links documents
- Audit trail

**Enhancement Needed:**
- Add stock reservation on conversion
- Add approval workflow trigger
- Close opportunity automatically

---

## 🔴 CRITICAL - IMPLEMENT IMMEDIATELY (Week 1)

### 4. Approval Workflow System
**Status:** ❌ MISSING
**Priority:** CRITICAL
**Effort:** 1-2 days

**What to Build:**
- `lib/sales-approvals.ts` ✅ (Already created)
- Approval UI component
- Manager approval dashboard
- Email notifications to approvers

**Implementation Steps:**
1. Add approval state to store
2. Check discount % on quote creation
3. If > 10%, create approval request
4. Notify manager
5. Manager approves/rejects
6. Update quote status

**Code Already Created:**
- ✅ Types in `lib/sales-flow-types.ts`
- ✅ Logic in `lib/sales-approvals.ts`
- ⚠️ Need to integrate into store
- ⚠️ Need UI components

### 5. Inventory Reservation
**Status:** ❌ MISSING
**Priority:** CRITICAL
**Effort:** 1 day

**What to Build:**
- Stock reservation tracking
- Reserve on SO creation
- Release on cancellation
- Fulfill on delivery

**Implementation:**
```typescript
// Add to store.tsx
const [stockReservations, setStockReservations] = useState<StockReservation[]>([])

reserveStock: (soId, soRef, lines) => {
  lines.forEach(line => {
    const product = products.find(p => p.id === line.productId)
    const available = product.stockQty - getReservedQty(line.productId)
    
    if (available >= line.qty) {
      const reservation: StockReservation = {
        id: uid(),
        productId: line.productId,
        productName: line.productName,
        qty: line.qty,
        reservedFor: 'sales_order',
        referenceId: soId,
        referenceRef: soRef,
        status: 'reserved',
        reservedDate: now(),
        expiresDate: addDays(now(), 7),
        // ...
      }
      setStockReservations(prev => [...prev, reservation])
    }
  })
}
```

### 6. Delivery Module
**Status:** ✅ UI CREATED (50%)
**Priority:** CRITICAL
**Effort:** 2-3 days

**Already Created:**
- ✅ `components/modules/Delivery.tsx` - UI component
- ✅ `lib/sales-flow-types.ts` - Types defined

**Still Need:**
1. Add Delivery to module router
2. Add delivery functions to store:
   - `createDeliveryNote()`
   - `startPicking()`
   - `confirmPicking()`
   - `validateDelivery()`
   - `confirmDelivery()`
3. Stock deduction logic
4. Serial number validation
5. Signature capture

### 7. Stock Deduction on Delivery
**Status:** ❌ MISSING
**Priority:** CRITICAL
**Effort:** 1 day

**Current Issue:**
- Stock deducts on SO creation (wrong!)
- Should deduct only after delivery validation

**Fix:**
```typescript
confirmDelivery: (deliveryId) => {
  const delivery = deliveries.find(d => d.id === deliveryId)
  
  // Validate all items
  delivery.lines.forEach(line => {
    // Deduct stock
    setProducts(p => p.map(prod => 
      prod.id === line.productId 
        ? { ...prod, stockQty: prod.stockQty - line.qtyDelivered }
        : prod
    ))
    
    // Update serials if tracked
    if (line.requiresSerial) {
      line.serialIds.forEach(serialId => {
        setSerials(s => s.map(ser => 
          ser.id === serialId
            ? { ...ser, status: 'sold', location: 'customer', soldDate: now() }
            : ser
        ))
      })
    }
    
    // Fulfill reservation
    fulfillReservation(line.productId, delivery.salesOrderId, line.qtyDelivered)
  })
  
  // Update delivery status
  setDeliveries(d => d.map(del => 
    del.id === deliveryId
      ? { ...del, status: 'delivered', actualDate: now(), validated: true }
      : del
  ))
  
  // Auto-create invoice
  createInvoiceFromDelivery(deliveryId)
}
```

---

## 🟡 IMPORTANT - IMPLEMENT NEXT (Week 2)

### 8. Payment Tracking Enhancement
**Status:** 🟡 PARTIAL (60%)
**Priority:** HIGH
**Effort:** 1-2 days

**Current:**
- Basic payment recording exists
- Single payment per invoice

**Add:**
- Multi-invoice allocation
- Partial payment tracking
- Payment reconciliation UI
- Outstanding balance view
- Payment reminders

### 9. Credit Limit Enforcement
**Status:** ❌ MISSING
**Priority:** HIGH
**Effort:** 1 day

**Implementation:**
```typescript
checkCreditLimit: (customerId, orderTotal) => {
  const customer = companies.find(c => c.id === customerId)
  if (!customer) return { ok: true }
  
  const outstanding = invoices
    .filter(inv => inv.partnerId === customerId && inv.status === 'posted')
    .reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0)
  
  const creditUsed = outstanding + orderTotal
  const creditAvailable = customer.creditLimit - outstanding
  
  if (creditUsed > customer.creditLimit) {
    return {
      ok: false,
      message: `Credit limit exceeded. Limit: ${fmtKes(customer.creditLimit)}, Used: ${fmtKes(outstanding)}, Available: ${fmtKes(creditAvailable)}`,
      requiresApproval: true
    }
  }
  
  return { ok: true, creditAvailable }
}
```

---

## 🟢 NICE TO HAVE (Week 3-4)

### 10. Warranty System
**Status:** 🟡 BASIC EXISTS (40%)
**Priority:** MEDIUM

Current: Basic warranty tracking exists
Add: Automatic activation on delivery

### 11. RMA/Returns System
**Status:** ❌ MISSING
**Priority:** MEDIUM

Create returns module with proper workflow

### 12. Sales Dashboard
**Status:** ❌ MISSING
**Priority:** MEDIUM

Analytics and KPIs

### 13. Repair-to-Sales Conversion
**Status:** ❌ MISSING
**Priority:** LOW

Special case for parts sales during repair

---

## 🚀 QUICK START GUIDE

### What to Do RIGHT NOW (30 minutes)

#### Step 1: Add Delivery Module to Navigation (5 min)

File: `components/AppShell.tsx`

```typescript
import Delivery from '@/components/modules/Delivery'

const moduleMap: Record<ModuleId, React.ComponentType> = {
  // ... existing
  delivery: Delivery, // ADD THIS
}
```

File: `lib/store.tsx` - Add to ModuleId type:
```typescript
export type ModuleId = 'dashboard' | 'sales' | 'crm' | 'inventory' | 'contacts' | 'purchase' | 'pos' | 'repair' | 'delivery' | 'ecommerce' | 'accounting' | 'hr'
```

File: `components/layout/Sidebar.tsx` - Add to modules array:
```typescript
{ id: 'delivery', label: 'Delivery', icon: '🚚', color: '#10B981' },
```

File: `components/layout/Topbar.tsx` - Add to titles:
```typescript
delivery: { label: 'Delivery', desc: 'Order fulfillment & dispatch' },
```

#### Step 2: Enhance convertQuoteToSaleOrder (10 min)

File: `lib/store.tsx:2481`

Add after line 2536 (after setSaleOrders):
```typescript
// Close opportunity if linked
if (quote.opportunityId) {
  setOpportunities(prev => prev.map(opp =>
    opp.id === quote.opportunityId
      ? { ...opp, stage: 'closed_won', actualValue: quote.total, closedDate: now() }
      : opp
  ))
}

// Update quote status
setQuotes(prev => prev.map(q => 
  q.id === quoteId 
    ? { ...q, status: 'accepted', saleOrderId: so.id, convertedDate: now() }
    : q
))
```

#### Step 3: Test the Flow (15 min)

1. Create opportunity in CRM
2. Generate quote
3. Accept quote
4. Convert to SO
5. Go to Delivery module
6. Pick items
7. Confirm delivery
8. Verify stock deducted

---

## 📋 COMPLETE IMPLEMENTATION CHECKLIST

### Core Sales Flow ✅
- [x] Lead management
- [x] Opportunity pipeline
- [x] Quote generation
- [x] PDF export
- [x] Email/WhatsApp sending
- [x] Quote-to-SO conversion
- [ ] Stock reservation on SO
- [ ] Delivery module integration
- [ ] Stock deduction on delivery
- [ ] Auto-invoicing
- [ ] Payment recording

### Approvals ⚠️
- [ ] Discount approval workflow
- [ ] Multi-level approvals
- [ ] Approval notifications
- [ ] Override capabilities
- [ ] Approval dashboard

### Controls ⚠️
- [ ] Stock availability checks
- [ ] Credit limit enforcement
- [ ] Serial number validation
- [ ] Cannot delete (only cancel)
- [ ] Pricing lock after confirmation
- [ ] Audit trail for all changes

### After-Sales ⚠️
- [ ] Warranty activation
- [ ] Warranty claims
- [ ] RMA/Returns
- [ ] Repair linkage

### Analytics ⚠️
- [ ] Sales dashboard
- [ ] Revenue metrics
- [ ] Rep performance
- [ ] Product insights
- [ ] Pipeline reports

---

## 🎬 START HERE - Day 1 Implementation

Copy and run these changes to get core flow working:

### File 1: Add delivery module to types

File: `lib/auth/types.ts` or `lib/store.tsx` (wherever ModuleId is defined)

```typescript
export type ModuleId = 
  | 'dashboard' 
  | 'sales'
  | 'crm' 
  | 'inventory' 
  | 'contacts' 
  | 'purchase' 
  | 'pos' 
  | 'repair'
  | 'delivery'  // ADD THIS
  | 'ecommerce' 
  | 'accounting' 
  | 'hr'
```

### File 2: Add to AppShell

File: `components/AppShell.tsx`

```typescript
// Add import
import Delivery from '@/components/modules/Delivery'

// Add to moduleMap
const moduleMap: Record<ModuleId, React.ComponentType> = {
  dashboard: Dashboard,
  sales: Sales,
  crm: CRM,
  inventory: Inventory,
  contacts: Contacts,
  purchase: Purchase,
  pos: POS,
  repair: Repair,
  delivery: Delivery, // ADD THIS LINE
  ecommerce: Ecommerce,
  accounting: Accounting,
  hr: HR,
}
```

### File 3: Add to Sidebar

File: `components/layout/Sidebar.tsx`

```typescript
const modules = [
  { id: 'dashboard',  label: 'Dashboard',    icon: '⊞',  color: '#9095B0' },
  { id: 'sales',      label: 'Sales',        icon: '💼', color: '#875BF7' },
  { id: 'crm',        label: 'CRM',          icon: '🎯', color: '#7F56D9' },
  { id: 'inventory',  label: 'Inventory',    icon: '📦', color: '#F79009' },
  { id: 'contacts',   label: 'Contacts',     icon: '👥', color: '#2E90FA' },
  { id: 'purchase',   label: 'Purchase',     icon: '🛒', color: '#12B76A' },
  { id: 'pos',        label: 'Point of Sale',icon: '🖥️', color: '#EE46BC' },
  { id: 'repair',     label: 'Repairs',      icon: '🔧', color: '#F04438' },
  { id: 'delivery',   label: 'Delivery',     icon: '🚚', color: '#10B981' }, // ADD THIS LINE
  { id: 'ecommerce',  label: 'eCommerce',    icon: '🌐', color: '#06AED4' },
  { id: 'accounting', label: 'Accounting',   icon: '📊', color: '#6ce9a6' },
  { id: 'hr',         label: 'HR',           icon: '👤', color: '#8B5CF6' },
]
```

### File 4: Add to Topbar

File: `components/layout/Topbar.tsx`

```typescript
const titles: Record<ModuleId, { label: string; desc: string }> = {
  // ... existing titles
  delivery: { label: 'Delivery', desc: 'Order fulfillment & dispatch' }, // ADD THIS LINE
}
```

### File 5: Add to Access Control

File: `lib/auth/access.ts`

Add 'delivery' to allowed modules for relevant roles.

---

## 📅 Week-by-Week Breakdown

### Week 1: Core Functionality (Days 1-5)

**Day 1: Delivery Module Setup**
- ✅ Add delivery module to navigation (above steps)
- ✅ Test delivery UI
- ⚠️ Add delivery functions to store

**Day 2: Stock Reservation**
- Add stockReservations state
- Implement reserveStock()
- Integrate with SO conversion
- Test reservation logic

**Day 3: Delivery Functions**
- Create delivery note from SO
- Picking workflow
- Serial validation
- Stock deduction on confirm

**Day 4: Approval Workflow**
- Add approvalRequests state
- Integrate approval checks
- Create approval UI
- Test approval flow

**Day 5: Integration Testing**
- Test full flow: Quote → SO → Delivery → Invoice
- Fix any issues
- Document workflows

### Week 2: Controls & Validation (Days 6-10)

**Day 6: Credit Management**
- Credit limit checks
- Outstanding calculation
- Approval for exceeding limit

**Day 7: Stock Controls**
- Cannot sell without stock (config)
- Backorder management
- Stock alerts

**Day 8: Pricing Controls**
- Margin validation
- Price lock after confirmation
- Special pricing approval

**Day 9: Document Controls**
- Cannot delete (only cancel)
- Cancellation reasons required
- Modification restrictions

**Day 10: Testing & Fixes**

### Week 3: Payments & Finance (Days 11-15)

**Day 11-12: Payment Enhancement**
- Multi-invoice allocation
- Partial payments
- Payment reconciliation

**Day 13-14: Credit & Collections**
- Aging reports
- Payment reminders
- Overdue tracking

**Day 15: Testing**

### Week 4: After-Sales (Days 16-20)

**Day 16-17: Warranty System**
- Auto-activation on delivery
- Warranty claims
- Repair integration

**Day 18-19: RMA/Returns**
- Return requests
- Return processing
- Refund/exchange workflow

**Day 20: Testing**

### Week 5: Analytics & Dashboard (Days 21-25)

**Day 21-23: Sales Dashboard**
- Revenue metrics
- Pipeline analytics
- Product reports

**Day 24-25: Rep Performance**
- Individual metrics
- Targets vs actual
- Commission calculation

### Week 6: Polish & Training (Days 26-30)

**Days 26-28: Integration & Polish**
- Fix remaining bugs
- Performance optimization
- UI/UX improvements

**Days 29-30: Training & Launch**
- User training sessions
- Documentation
- Go-live support

---

## 🎯 MINIMAL VIABLE IMPLEMENTATION (This Week!)

If you want just the essentials working ASAP:

### Must-Have (Can launch with this)

1. ✅ Lead & Opportunity (already working)
2. ✅ Quotation (already working)
3. ✅ Quote-to-SO (already working)
4. ⚠️ **Delivery Module** (add to nav + basic picking)
5. ⚠️ **Stock Deduction** (on delivery confirm)
6. ✅ Invoice (already working)
7. ✅ Payment (basic already working)

### Nice-to-Have (Add next week)

8. Approval workflows
9. Stock reservation
10. Credit limits
11. Returns/RMA

---

## 💻 IMPLEMENTATION COMMANDS

To add delivery module right now, run these:

```bash
# 1. Module already created (Delivery.tsx exists)

# 2. Add to types - MANUAL EDIT NEEDED
# Edit lib/store.tsx - add 'delivery' to ModuleId type

# 3. Add to AppShell - MANUAL EDIT NEEDED  
# Edit components/AppShell.tsx - import and add to moduleMap

# 4. Add to Sidebar - MANUAL EDIT NEEDED
# Edit components/layout/Sidebar.tsx - add to modules array

# 5. Add to Topbar - MANUAL EDIT NEEDED
# Edit components/layout/Topbar.tsx - add to titles

# 6. Test
npm run dev
```

---

## 📊 EFFORT ESTIMATION

| Feature | Priority | Effort | Impact | Status |
|---------|----------|--------|--------|--------|
| Delivery Module | CRITICAL | 2 days | HIGH | 50% done |
| Stock Reservation | CRITICAL | 1 day | HIGH | 0% |
| Stock Deduction Fix | CRITICAL | 4 hours | HIGH | 0% |
| Approval Workflow | HIGH | 2 days | MEDIUM | 80% done (code ready) |
| Credit Limits | HIGH | 1 day | MEDIUM | 0% |
| Payment Allocation | MEDIUM | 1 day | MEDIUM | 0% |
| Warranty Auto | MEDIUM | 4 hours | LOW | 0% |
| RMA/Returns | MEDIUM | 2 days | LOW | 0% |
| Dashboard | LOW | 3 days | MEDIUM | 0% |

**Total Effort:** 12-15 days (2-3 weeks with 1 developer)

---

## 🎓 WHAT YOU NEED TO KNOW

### The Current Sales Flow (Working)

```
1. Create Lead (CRM) ✅
2. Convert to Opportunity ✅
3. Generate Quote ✅
4. Send to Customer (Email/WhatsApp) ✅
5. Customer Accepts via Portal ✅
6. Convert to Sales Order ✅
7. [DELIVERY MODULE - IN PROGRESS]
8. Generate Invoice (manual) ✅
9. Record Payment ✅
```

### The Gap (What's Missing)

```
6.5. Reserve Stock ❌
7. Create Delivery Note ⚠️ (UI exists, functions missing)
7.1. Pick Items ❌
7.2. Validate Serials ❌
7.3. Confirm Delivery ❌
7.4. Deduct Stock ❌
8. Auto-Invoice ❌
```

### Critical Control Missing

⚠️ **Stock currently deducts on SO creation, not on delivery!**

This is WRONG and needs fixing immediately.

---

## ✅ DECISION NEEDED

**Choose your path:**

**Option A: Complete Everything (6 weeks)**
- Full implementation of all features
- Comprehensive testing
- Training and documentation
- Gold standard solution

**Option B: Essential Only (1 week)**
- Delivery module working
- Stock deduction fixed
- Basic approval workflow
- Launch and iterate

**Option C: Step-by-Step Coaching**
- I guide you through each implementation
- You review and approve each step
- We test together
- Build confidence as we go

**Which option do you prefer?**

---

**Current Status:** 70% Complete
**Next Critical Task:** Wire Delivery Module to Navigation
**Time to Essential MVP:** 1 week
**Time to Full System:** 6 weeks

