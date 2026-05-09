# TypeScript Improvements Plan

This document outlines TypeScript improvements to enhance type safety and code quality across the Deed ERP project.

## Current State Analysis

### Issues Identified

1. **`any` types in store.tsx** (7541 lines)
   - Line 2015: `items: any[]` in requestProcurement
   - Line 2036: `stockReservations: any[]`
   - Line 2049: `approvalRequests: any[]`
   - Line 2051: `requestApproval: (type: string, details: any) => any`
   - Lines 2613, 6413, 6435: Inline `any` types in map/forEach

2. **Large monolithic files** (store.tsx is 7541 lines)
   - Difficult to maintain type definitions
   - Hard to find and fix type issues
   - Performance impact on IDE

3. **Missing type definitions** in components
   - Module components use implicit types
   - Props interfaces not always defined
   - Return types not always specified

4. **Inconsistent error handling**
   - Some functions throw errors without type safety
   - Error responses not properly typed
   - Try-catch blocks without proper error typing

## Improvement Strategy

### Phase 1: Enhance TypeScript Configuration

**Update `tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "exactOptionalPropertyTypes": false,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".next", "dist"]
}
```

### Phase 2: Create Type Definition Files

#### 1. Create `lib/types/index.ts`

```typescript
// lib/types/index.ts
export * from './common'
export * from './entities'
export * from './api'
export * from './forms'
export * from './store'
```

#### 2. Create `lib/types/common.ts`

```typescript
// lib/types/common.ts

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data: T
  status: number
  message: string
  timestamp: string
}

/**
 * Standard error response
 */
export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
  timestamp: string
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

/**
 * Result type for operations that can succeed or fail
 */
export type Result<T, E = ApiError> =
  | { success: true; data: T }
  | { success: false; error: E }

/**
 * Async result type
 */
export type AsyncResult<T, E = ApiError> = Promise<Result<T, E>>

/**
 * Status types
 */
export type Status = 'pending' | 'success' | 'error' | 'idle'

/**
 * Async state
 */
export interface AsyncState<T, E = ApiError> {
  status: Status
  data: T | null
  error: E | null
  isLoading: boolean
}
```

#### 3. Create `lib/types/entities.ts`

```typescript
// lib/types/entities.ts

/**
 * User entity
 */
export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  avatar?: string
  phone?: string
  department?: string
  createdAt: string
  updatedAt: string
}

export type UserRole = 'admin' | 'manager' | 'user' | 'viewer'

/**
 * Invoice entity
 */
export interface Invoice {
  id: string
  invoiceNo: string
  customerId: string
  amount: number
  tax: number
  total: number
  status: InvoiceStatus
  dueDate: string
  issuedDate: string
  items: InvoiceLineItem[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled'

export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
  taxRate: number
}

/**
 * Account entity
 */
export interface Account {
  id: string
  code: string
  name: string
  type: AccountType
  group: string
  balance: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense'
  | 'other'

/**
 * Journal entry
 */
export interface JournalEntry {
  id: string
  date: string
  description: string
  reference?: string
  lines: JournalLine[]
  status: 'draft' | 'posted'
  createdAt: string
  updatedAt: string
}

export interface JournalLine {
  id: string
  accountId: string
  debit: number
  credit: number
  description?: string
}
```

#### 4. Create `lib/types/forms.ts`

```typescript
// lib/types/forms.ts

/**
 * Form field error
 */
export interface FieldError {
  field: string
  message: string
}

/**
 * Form validation result
 */
export interface ValidationResult {
  isValid: boolean
  errors: FieldError[]
}

/**
 * Form state
 */
export interface FormState<T> {
  values: T
  errors: Record<keyof T, string | undefined>
  touched: Record<keyof T, boolean>
  isSubmitting: boolean
  isDirty: boolean
}

/**
 * Form field props
 */
export interface FormFieldProps<T> {
  name: keyof T
  label: string
  required?: boolean
  placeholder?: string
  type?: string
  disabled?: boolean
  error?: string
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
}
```

### Phase 3: Fix `any` Types in store.tsx

#### Current Issues:

```typescript
// ❌ Before: Using any types
requestProcurement: (repairId: string, items: any[], urgency: string, notes: string) => void

// ✅ After: Properly typed
requestProcurement: (repairId: string, items: ProcurementItem[], urgency: ProcurementUrgency, notes: string) => void
```

#### Steps to Fix:

1. **Create `lib/types/procurement.ts`:**

```typescript
export interface ProcurementItem {
  id: string
  description: string
  quantity: number
  estimatedCost: number
  priority: 'low' | 'medium' | 'high'
}

export type ProcurementUrgency = 'routine' | 'urgent' | 'critical'

export interface StockReservation {
  id: string
  itemId: string
  quantity: number
  reservedFor: string
  reservedAt: string
  expiresAt: string
}

export interface ApprovalRequest {
  id: string
  type: ApprovalType
  details: Record<string, unknown>
  status: ApprovalStatus
  requestedBy: string
  requestedAt: string
  approvedBy?: string
  approvedAt?: string
  notes?: string
}

export type ApprovalType = 'purchase' | 'expense' | 'leave' | 'other'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
```

2. **Update store.tsx imports:**

```typescript
import {
  ProcurementItem,
  ProcurementUrgency,
  StockReservation,
  ApprovalRequest,
  ApprovalType,
  ApprovalStatus,
} from '@/lib/types/procurement'
```

3. **Update store.tsx function signatures:**

```typescript
// ✅ After: Properly typed
requestProcurement: (repairId: string, items: ProcurementItem[], urgency: ProcurementUrgency, notes: string) => void
stockReservations: StockReservation[]
approvalRequests: ApprovalRequest[]
requestApproval: (type: ApprovalType, details: Record<string, unknown>) => Promise<ApprovalRequest>
```

### Phase 4: Add JSDoc Documentation

#### Pattern for Functions:

```typescript
/**
 * Calculates the total invoice amount including tax
 * @param items - Array of invoice line items
 * @param taxRate - Tax rate as decimal (e.g., 0.16 for 16%)
 * @returns Total amount including tax
 * @throws {Error} If items array is empty
 */
export function calculateInvoiceTotal(
  items: InvoiceLineItem[],
  taxRate: number
): number {
  if (items.length === 0) {
    throw new Error('Invoice must have at least one line item')
  }
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0)
  return subtotal * (1 + taxRate)
}
```

#### Pattern for Components:

```typescript
/**
 * Displays an invoice with editable line items
 * @param invoice - The invoice to display
 * @param onSave - Callback when invoice is saved
 * @param onCancel - Callback when edit is cancelled
 * @param readOnly - Whether the invoice is read-only
 */
export function InvoiceEditor({
  invoice,
  onSave,
  onCancel,
  readOnly = false,
}: InvoiceEditorProps) {
  // implementation
}
```

### Phase 5: Improve Error Handling

#### Create `lib/errors.ts`:

```typescript
/**
 * Custom error class for API errors
 */
export class ApiErrorClass extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Custom error class for validation errors
 */
export class ValidationErrorClass extends Error {
  constructor(
    public errors: FieldError[]
  ) {
    super('Validation failed')
    this.name = 'ValidationError'
  }
}

/**
 * Type guard for ApiError
 */
export function isApiError(error: unknown): error is ApiErrorClass {
  return error instanceof ApiErrorClass
}

/**
 * Type guard for ValidationError
 */
export function isValidationError(error: unknown): error is ValidationErrorClass {
  return error instanceof ValidationErrorClass
}

/**
 * Safe error handling
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unknown error occurred'
}
```

### Phase 6: Update Component Props

#### Before:

```typescript
function UserCard(props: any) {
  return <div>{props.name}</div>
}
```

#### After:

```typescript
/**
 * Props for UserCard component
 */
interface UserCardProps {
  user: User
  onEdit?: (user: User) => void
  onDelete?: (userId: string) => void
  showActions?: boolean
}

/**
 * Displays a user card with basic information
 */
export function UserCard({
  user,
  onEdit,
  onDelete,
  showActions = true,
}: UserCardProps) {
  return (
    <div className="card">
      <h3>{user.name}</h3>
      <p>{user.email}</p>
      {showActions && (
        <div className="actions">
          {onEdit && <button onClick={() => onEdit(user)}>Edit</button>}
          {onDelete && <button onClick={() => onDelete(user.id)}>Delete</button>}
        </div>
      )}
    </div>
  )
}
```

## Implementation Priority

### High Priority (Do First)

1. ✅ Create `lib/types/` directory structure
2. ✅ Create common types (ApiResponse, Result, AsyncState)
3. ✅ Create entity types (User, Invoice, Account, etc.)
4. ✅ Fix `any` types in store.tsx
5. ✅ Add JSDoc to store functions

### Medium Priority (Do Next)

1. Update component props interfaces
2. Add error handling types
3. Add form types
4. Update module components with proper types

### Low Priority (Do Later)

1. Add comprehensive JSDoc to all functions
2. Create utility function types
3. Add test types
4. Create API types

## Tools and Scripts

### ESLint Configuration

Add to `.eslintrc.json`:

```json
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-implicit-any": "error",
    "@typescript-eslint/explicit-function-return-types": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "warn",
    "@typescript-eslint/no-unused-vars": "warn"
  }
}
```

### Find `any` Types Script

```bash
# Find all any types in the codebase
grep -r ": any" --include="*.ts" --include="*.tsx" .

# Find any in function parameters
grep -r "(\w*: any" --include="*.ts" --include="*.tsx" .

# Find any in return types
grep -r "): any" --include="*.ts" --include="*.tsx" .
```

## Checklist

- [ ] Create `lib/types/` directory structure
- [ ] Create common types file
- [ ] Create entity types file
- [ ] Create form types file
- [ ] Fix `any` types in store.tsx
- [ ] Add JSDoc to store functions
- [ ] Update component props interfaces
- [ ] Add error handling types
- [ ] Update ESLint configuration
- [ ] Run type checker: `tsc --noEmit`
- [ ] Review and merge changes

## Benefits

1. **Better IDE Support**: Auto-completion and type hints
2. **Fewer Runtime Errors**: Type safety catches errors at compile time
3. **Better Documentation**: Types serve as inline documentation
4. **Easier Refactoring**: Type checker prevents breaking changes
5. **Improved Code Quality**: Consistent type patterns across codebase
6. **Better Maintainability**: New developers understand code faster

## Next Steps

1. Create `lib/types/` directory and files
2. Update store.tsx with proper types
3. Update component props interfaces
4. Add error handling types
5. Run type checker and fix remaining issues
6. Update ESLint configuration
7. Document type patterns in CODE_STYLE_GUIDE.md
