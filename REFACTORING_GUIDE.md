# Module Refactoring Guide

This guide documents the best practices and patterns for refactoring large monolithic module components into smaller, maintainable sub-components.

## Problem Statement

The current ERP has several large module files that are difficult to maintain:

- **HR.tsx**: 141 KB - Contains HR, payroll, and leave management
- **Accounting.tsx**: 84 KB (1536 lines) - Contains invoices, bills, journals, reports
- **CRM.tsx**: 72 KB - Contains deals, opportunities, contracts
- **Inventory.tsx**: 71 KB - Contains products, stock, warehouses
- **Sales.tsx**: 60 KB - Contains quotes, orders, invoicing
- **Dashboard.tsx**: 63 KB - Contains multiple dashboard views
- **Cashbook.tsx**: 60 KB - Contains cash management and reconciliation
- **HRSettings.tsx**: 64 KB - Contains HR configuration

These files suffer from:
- Poor code organization and readability
- Difficult to test individual features
- Hard to reuse components across modules
- Complex state management
- Difficult to navigate and understand

## Solution: Module Decomposition

Break large modules into smaller, focused sub-components organized by feature or domain.

### Directory Structure Pattern

```
components/modules/
├── Accounting.tsx                    # Main export (wrapper)
├── accounting/                       # Sub-components directory
│   ├── index.ts                      # Re-exports
│   ├── types.ts                      # TypeScript types and interfaces
│   ├── constants.ts                  # Constants and configurations
│   ├── hooks.ts                      # Custom hooks
│   ├── utils.ts                      # Utility functions
│   ├── AccountingContext.tsx         # Context provider (already exists)
│   ├── tabs/
│   │   ├── InvoicesTab.tsx          # Invoices management
│   │   ├── BillsTab.tsx             # Bills management
│   │   ├── JournalsTab.tsx          # Journal entries (already exists)
│   │   ├── RefundsTab.tsx           # Refund management
│   │   ├── ReportsTab.tsx           # Financial reports
│   │   └── CashbookTab.tsx          # Cashbook (already exists)
│   ├── reports/
│   │   ├── BalanceSheet.tsx         # Balance sheet report
│   │   ├── ProfitLoss.tsx           # P&L report
│   │   ├── GeneralLedger.tsx        # General ledger
│   │   └── PartnerLedger.tsx        # Partner ledger
│   ├── modals/
│   │   ├── InvoiceModal.tsx         # Invoice creation/edit
│   │   ├── BillModal.tsx            # Bill creation/edit
│   │   ├── JournalModal.tsx         # Journal entry creation
│   │   └── AccountModal.tsx         # Account creation/edit
│   └── components/
│       ├── InvoiceTable.tsx         # Reusable invoice table
│       ├── BillTable.tsx            # Reusable bill table
│       ├── AccountTable.tsx         # Reusable account table
│       └── StatCards.tsx            # KPI stat cards
```

### Step-by-Step Refactoring Process

#### 1. **Create Types File** (`accounting/types.ts`)

Extract all TypeScript types and interfaces:

```typescript
// accounting/types.ts
export interface AccountingState {
  invoices: Invoice[]
  bills: Invoice[]
  journalEntries: JournalEntry[]
  accounts: Account[]
  // ... other state
}

export interface AccountingActions {
  addInvoice: (invoice: Invoice) => void
  updateInvoice: (id: string, updates: Partial<Invoice>) => void
  deleteInvoice: (id: string) => void
  // ... other actions
}

export type MainTab = 'invoices' | 'bills' | 'journals' | 'refunds' | 'coa' | 'gl' | 'partner_ledger' | 'pl' | 'bs' | 'cashbook'
```

#### 2. **Create Constants File** (`accounting/constants.ts`)

Extract all constants and configuration:

```typescript
// accounting/constants.ts
export const CA_GROUPS = [
  'Inventory - Closing',
  'Receivables - Product',
  // ...
]

export const FISCAL_YEAR = new Date().getFullYear().toString()

export const REPORT_DATE = new Date().toLocaleDateString('en-KE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
```

#### 3. **Create Utils File** (`accounting/utils.ts`)

Extract utility functions:

```typescript
// accounting/utils.ts
export const uid = () => Math.random().toString(36).slice(2, 9)

export const today = () => new Date().toISOString().slice(0, 10)

export const addDays = (d: string, n: number) => {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt.toISOString().slice(0, 10)
}

export const buildPdfHeader = (
  lines: PdfLine[],
  title: string,
  subtitle: string,
  companySettings: CompanySettings
): PdfLine[] => {
  // ... implementation
}
```

#### 4. **Create Hooks File** (`accounting/hooks.ts`)

Extract custom hooks:

```typescript
// accounting/hooks.ts
export function useAccountingData() {
  const appState = useApp()
  // Extract and memoize accounting-specific data
  return { /* computed data */ }
}

export function useTabNavigation() {
  const searchParams = useSearchParams()
  const router = useRouter()
  // Tab navigation logic
  return { tab, setTab }
}

export function useCashbookTotals() {
  // Cashbook calculation logic
  return { cashAtBank, cashInHand }
}
```

#### 5. **Extract Tab Components**

Create separate files for each tab:

```typescript
// accounting/tabs/InvoicesTab.tsx
export function InvoicesTab() {
  const { invoices, registerPayment, deleteInvoice } = useApp()
  // Invoice management UI
}

// accounting/tabs/BillsTab.tsx
export function BillsTab() {
  const { invoices } = useApp()
  // Bill management UI
}

// accounting/tabs/ReportsTab.tsx
export function ReportsTab() {
  // Reports UI with sub-tabs
}
```

#### 6. **Extract Report Components**

Create separate files for each report:

```typescript
// accounting/reports/BalanceSheet.tsx
export function BalanceSheetReport() {
  // Balance sheet rendering
}

// accounting/reports/ProfitLoss.tsx
export function ProfitLossReport() {
  // P&L rendering
}
```

#### 7. **Extract Modal Components**

Create separate files for modals:

```typescript
// accounting/modals/InvoiceModal.tsx
export function InvoiceModal({ onClose, invoice }: InvoiceModalProps) {
  // Invoice creation/edit form
}

// accounting/modals/BillModal.tsx
export function BillModal({ onClose, bill }: BillModalProps) {
  // Bill creation/edit form
}
```

#### 8. **Extract Reusable Components**

Create shared components:

```typescript
// accounting/components/InvoiceTable.tsx
export function InvoiceTable({ invoices, onEdit, onDelete }: InvoiceTableProps) {
  // Reusable invoice table
}

// accounting/components/StatCards.tsx
export function AccountingStatCards({ stats }: StatCardsProps) {
  // KPI stat cards
}
```

#### 9. **Create Index File** (`accounting/index.ts`)

Re-export all components:

```typescript
// accounting/index.ts
export { InvoicesTab } from './tabs/InvoicesTab'
export { BillsTab } from './tabs/BillsTab'
export { JournalsTab } from './tabs/JournalsTab'
export { ReportsTab } from './tabs/ReportsTab'

export { BalanceSheetReport } from './reports/BalanceSheet'
export { ProfitLossReport } from './reports/ProfitLoss'

export { InvoiceModal } from './modals/InvoiceModal'
export { BillModal } from './modals/BillModal'

export { InvoiceTable } from './components/InvoiceTable'
export { StatCards } from './components/StatCards'

export type { AccountingState, AccountingActions, MainTab } from './types'
export { CA_GROUPS, NCA_GROUPS, FISCAL_YEAR } from './constants'
export { uid, today, addDays, buildPdfHeader } from './utils'
```

#### 10. **Update Main Module File** (`Accounting.tsx`)

Simplify the main file to orchestrate sub-components:

```typescript
// Accounting.tsx
import { Suspense } from 'react'
import { ModuleSkeleton } from '@/components/ui'
import { AccountingProvider } from './accounting/AccountingContext'
import { InvoicesTab, BillsTab, ReportsTab, CashbookTab } from './accounting'
import { useTabNavigation } from './accounting/hooks'

export default function Accounting() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <AccountingProvider>
        <AccountingContent />
      </AccountingProvider>
    </Suspense>
  )
}

function AccountingContent() {
  const { tab, setTab } = useTabNavigation()

  return (
    <div className="flex flex-col gap-4">
      {/* Tab navigation */}
      <TabBar activeKey={tab} onChange={setTab} tabs={[
        { key: 'invoices', label: 'Invoices' },
        { key: 'bills', label: 'Bills' },
        { key: 'journals', label: 'Journals' },
        { key: 'reports', label: 'Reports' },
        { key: 'cashbook', label: 'Cashbook' },
      ]} />

      {/* Tab content */}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'bills' && <BillsTab />}
      {tab === 'journals' && <JournalsTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'cashbook' && <CashbookTab />}
    </div>
  )
}
```

## Benefits of This Approach

1. **Better Organization**: Each file has a single responsibility
2. **Improved Readability**: Easier to understand and navigate code
3. **Better Reusability**: Components can be used in other modules
4. **Easier Testing**: Smaller components are easier to test
5. **Reduced Complexity**: State and logic are organized by feature
6. **Better Performance**: Easier to implement code splitting
7. **Easier Maintenance**: Bugs are easier to find and fix
8. **Scalability**: New features can be added without bloating existing files

## Implementation Order

1. **Start with types and constants** - No dependencies, easy to extract
2. **Extract utilities** - Used by other components
3. **Create hooks** - Encapsulate complex logic
4. **Extract sub-components** - Modularize UI
5. **Update main file** - Orchestrate sub-components

## TypeScript Best Practices

1. **Use strict types** - Avoid `any` types
2. **Export interfaces** - Make types reusable
3. **Use discriminated unions** - For complex state
4. **Add JSDoc comments** - Document complex functions
5. **Use generics** - For reusable components

## Code Quality Checklist

- [ ] All files have clear, single responsibilities
- [ ] No circular dependencies
- [ ] All imports are explicit and organized
- [ ] TypeScript strict mode enabled
- [ ] All functions have JSDoc comments
- [ ] No hardcoded values (use constants)
- [ ] Utility functions are pure and testable
- [ ] Components are properly memoized where needed
- [ ] State management is centralized
- [ ] Error handling is consistent

## Example: Accounting Module Refactoring

The Accounting module has been partially refactored with:
- `AccountingContext.tsx` - State management
- `JournalsTab.tsx` - Journal entries tab
- `ChartOfAccountsTab.tsx` - Chart of accounts tab
- `GeneralLedgerTab.tsx` - General ledger tab
- `PartnerLedgerTab.tsx` - Partner ledger tab

**Next steps for complete refactoring:**
1. Extract InvoicesTab, BillsTab, RefundsTab
2. Extract report components (BalanceSheet, ProfitLoss)
3. Extract modals (InvoiceModal, BillModal, AccountModal)
4. Extract utility functions to utils.ts
5. Extract constants to constants.ts
6. Create types.ts for TypeScript interfaces
7. Create hooks.ts for custom hooks
8. Update main Accounting.tsx to orchestrate sub-components

## Applying to Other Modules

This pattern can be applied to other large modules:

- **HR.tsx** → `hr/` directory with tabs, modals, reports
- **CRM.tsx** → `crm/` directory with deals, opportunities, contracts
- **Sales.tsx** → `sales/` directory with quotes, orders, invoicing
- **Inventory.tsx** → `inventory/` directory with products, stock, warehouses
- **Dashboard.tsx** → `dashboard/` directory with different dashboard views

## Performance Considerations

1. **Code Splitting**: Use React.lazy() for tab components
2. **Memoization**: Use useMemo() for expensive calculations
3. **Context**: Use multiple contexts to avoid unnecessary re-renders
4. **Virtualization**: Use virtualized lists for large tables

## Conclusion

This refactoring pattern improves code quality, maintainability, and scalability without changing the user-facing functionality. Start with one module and use it as a template for refactoring others.
