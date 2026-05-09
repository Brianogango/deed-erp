# Code Style Guide - Deed ERP

This guide establishes consistent patterns and best practices for writing TypeScript and React code in the Deed ERP project.

## Table of Contents

1. [TypeScript](#typescript)
2. [React Components](#react-components)
3. [File Organization](#file-organization)
4. [Naming Conventions](#naming-conventions)
5. [Component Structure](#component-structure)
6. [State Management](#state-management)
7. [Styling](#styling)
8. [Documentation](#documentation)
9. [Performance](#performance)
10. [Testing](#testing)

## TypeScript

### Type Definitions

**✅ DO: Use explicit types**

```typescript
interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user' | 'viewer'
}

function getUser(id: string): User | null {
  // implementation
}
```

**❌ DON'T: Use `any` types**

```typescript
function getUser(id: any): any {
  // implementation
}
```

### Discriminated Unions

**✅ DO: Use discriminated unions for complex state**

```typescript
type Result<T> = 
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string }

function useData<T>(): Result<T> {
  // implementation
}
```

**❌ DON'T: Use multiple optional fields**

```typescript
interface Result<T> {
  loading?: boolean
  data?: T
  error?: string
}
```

### Generics

**✅ DO: Use generics for reusable code**

```typescript
interface ApiResponse<T> {
  data: T
  status: number
  message: string
}

async function fetchData<T>(url: string): Promise<ApiResponse<T>> {
  // implementation
}
```

### Enums

**✅ DO: Use `as const` instead of enums for better tree-shaking**

```typescript
const USER_ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  VIEWER: 'viewer',
} as const

type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES]
```

**❌ DON'T: Use traditional enums**

```typescript
enum UserRole {
  Admin = 'admin',
  User = 'user',
  Viewer = 'viewer',
}
```

## React Components

### Functional Components

**✅ DO: Use functional components with hooks**

```typescript
interface ButtonProps {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}

export function Button({
  label,
  onClick,
  variant = 'primary',
  disabled = false,
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
```

### Props Destructuring

**✅ DO: Destructure props with type annotation**

```typescript
interface CardProps {
  title: string
  description?: string
  children: React.ReactNode
}

export function Card({ title, description, children }: CardProps) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  )
}
```

**❌ DON'T: Use `React.FC` or `React.FunctionComponent`**

```typescript
const Card: React.FC<CardProps> = ({ title, description, children }) => {
  // implementation
}
```

### Hooks

**✅ DO: Extract complex logic into custom hooks**

```typescript
function useFormState(initialValues: Record<string, string>) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setValues(prev => ({ ...prev, [name]: value }))
  }

  return { values, errors, handleChange, setErrors }
}
```

**✅ DO: Use `useCallback` for event handlers**

```typescript
function SearchInput({ onSearch }: { onSearch: (query: string) => void }) {
  const handleSearch = useCallback((query: string) => {
    onSearch(query)
  }, [onSearch])

  return <input onChange={e => handleSearch(e.target.value)} />
}
```

**✅ DO: Use `useMemo` for expensive calculations**

```typescript
function DataTable({ data }: { data: Item[] }) {
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  return <table>{/* render sortedData */}</table>
}
```

### Conditional Rendering

**✅ DO: Use ternary for simple conditions**

```typescript
return (
  <div>
    {isLoading ? <Spinner /> : <Content />}
  </div>
)
```

**✅ DO: Use logical AND for single conditions**

```typescript
return (
  <div>
    {error && <ErrorMessage error={error} />}
    {data && <DataDisplay data={data} />}
  </div>
)
```

**✅ DO: Extract complex conditions into variables**

```typescript
const shouldShowForm = !isLoading && !error && !submitted
const shouldShowSuccess = submitted && !error

return (
  <div>
    {shouldShowForm && <Form />}
    {shouldShowSuccess && <SuccessMessage />}
  </div>
)
```

## File Organization

### Directory Structure

```
components/
├── layout/
│   ├── Sidebar.tsx
│   ├── Topbar.tsx
│   └── AppShell.tsx
├── modules/
│   ├── Dashboard.tsx
│   ├── Sales.tsx
│   ├── accounting/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── constants.ts
│   │   ├── hooks.ts
│   │   ├── utils.ts
│   │   ├── AccountingContext.tsx
│   │   ├── tabs/
│   │   ├── reports/
│   │   ├── modals/
│   │   └── components/
│   └── crm/
│       ├── index.ts
│       ├── types.ts
│       └── ...
├── ui/
│   └── index.tsx
└── icons.tsx

lib/
├── store.ts
├── auth/
├── utils/
└── api/

app/
├── globals.css
├── layout.tsx
├── page.tsx
└── api/
```

### File Naming

- **Components**: PascalCase (e.g., `UserCard.tsx`, `InvoiceTable.tsx`)
- **Utilities**: camelCase (e.g., `formatDate.ts`, `calculateTax.ts`)
- **Types**: camelCase (e.g., `types.ts`, `constants.ts`)
- **Hooks**: camelCase starting with `use` (e.g., `useFormState.ts`, `useApi.ts`)
- **Styles**: kebab-case (e.g., `form-input`, `stat-card`)

## Naming Conventions

### Variables and Functions

**✅ DO: Use descriptive names**

```typescript
const isLoading = true
const hasError = false
const getUserById = (id: string) => { /* ... */ }
const formatCurrencyAmount = (amount: number) => { /* ... */ }
```

**❌ DON'T: Use single letters or abbreviations**

```typescript
const l = true
const e = false
const getU = (i: string) => { /* ... */ }
const fmt = (a: number) => { /* ... */ }
```

### Boolean Variables

**✅ DO: Use `is`, `has`, `should` prefixes**

```typescript
const isActive = true
const hasPermission = false
const shouldShowModal = true
const canEdit = true
```

### Event Handlers

**✅ DO: Use `handle` prefix**

```typescript
const handleClick = () => { /* ... */ }
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => { /* ... */ }
const handleSubmit = (e: React.FormEvent) => { /* ... */ }
```

## Component Structure

### Standard Component Layout

```typescript
// 1. Imports
import { useState, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { Button, Input } from '@/components/ui'

// 2. Types
interface MyComponentProps {
  title: string
  onSubmit: (data: FormData) => void
  disabled?: boolean
}

// 3. Constants
const DEFAULT_TIMEOUT = 5000

// 4. Component
export function MyComponent({
  title,
  onSubmit,
  disabled = false,
}: MyComponentProps) {
  // Hooks
  const [isLoading, setIsLoading] = useState(false)
  const { showToast } = useApp()

  // Callbacks
  const handleSubmit = useCallback(async () => {
    setIsLoading(true)
    try {
      await onSubmit({})
      showToast('Success!', 'success')
    } catch (error) {
      showToast('Error occurred', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [onSubmit, showToast])

  // Render
  return (
    <div className="card">
      <h2>{title}</h2>
      <Button onClick={handleSubmit} disabled={disabled || isLoading}>
        {isLoading ? 'Loading...' : 'Submit'}
      </Button>
    </div>
  )
}

// 5. Sub-components (if needed)
function FormField({ label, value }: FormFieldProps) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <Input value={value} />
    </div>
  )
}
```

## State Management

### Local State

**✅ DO: Use `useState` for component-level state**

```typescript
function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  )
}
```

### Global State

**✅ DO: Use Zustand store for global state**

```typescript
// lib/store.ts
import { create } from 'zustand'

interface AppState {
  user: User | null
  setUser: (user: User) => void
  logout: () => void
}

export const useApp = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  logout: () => set({ user: null }),
}))

// In component
function UserProfile() {
  const { user, logout } = useApp()

  return (
    <div>
      <p>{user?.name}</p>
      <button onClick={logout}>Logout</button>
    </div>
  )
}
```

### Context for Feature-Specific State

**✅ DO: Use Context for feature-specific state**

```typescript
interface AccountingContextType {
  invoices: Invoice[]
  addInvoice: (invoice: Invoice) => void
}

const AccountingContext = createContext<AccountingContextType | null>(null)

export function AccountingProvider({ children }: { children: React.ReactNode }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])

  const addInvoice = useCallback((invoice: Invoice) => {
    setInvoices(prev => [...prev, invoice])
  }, [])

  return (
    <AccountingContext.Provider value={{ invoices, addInvoice }}>
      {children}
    </AccountingContext.Provider>
  )
}

export function useAccounting() {
  const context = useContext(AccountingContext)
  if (!context) {
    throw new Error('useAccounting must be used within AccountingProvider')
  }
  return context
}
```

## Styling

### Tailwind CSS

**✅ DO: Use Tailwind classes**

```typescript
export function Card({ title, children }: CardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  )
}
```

**✅ DO: Use CSS variables for theme colors**

```typescript
export function Button({ variant = 'primary' }: ButtonProps) {
  return (
    <button
      className={`
        px-4 py-2 rounded-lg font-semibold transition-colors
        ${variant === 'primary'
          ? 'bg-primary-500 text-white hover:bg-primary-600'
          : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
        }
      `}
    >
      Click me
    </button>
  )
}
```

**✅ DO: Extract complex classes into globals.css**

```css
/* app/globals.css */
.btn-primary {
  @apply px-4 py-2 rounded-lg font-semibold text-white cursor-pointer
    transition-all duration-200 bg-primary-500 hover:bg-primary-600;
}

.card {
  @apply rounded-lg border border-gray-200 bg-white p-4 shadow-sm
    transition-all hover:shadow-md;
}
```

```typescript
export function Button() {
  return <button className="btn-primary">Click me</button>
}
```

**❌ DON'T: Use inline styles**

```typescript
export function Card() {
  return (
    <div style={{
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      backgroundColor: '#ffffff',
      padding: '16px',
    }}>
      Content
    </div>
  )
}
```

## Documentation

### JSDoc Comments

**✅ DO: Add JSDoc comments to functions**

```typescript
/**
 * Calculates the total price including tax
 * @param basePrice - The base price before tax
 * @param taxRate - The tax rate as a decimal (e.g., 0.16 for 16%)
 * @returns The total price including tax
 */
export function calculateTotalPrice(basePrice: number, taxRate: number): number {
  return basePrice * (1 + taxRate)
}
```

**✅ DO: Document component props**

```typescript
/**
 * Displays a user card with avatar and basic information
 * @param user - The user object containing name, email, and avatar
 * @param onEdit - Callback when the edit button is clicked
 * @param onDelete - Callback when the delete button is clicked
 */
export function UserCard({ user, onEdit, onDelete }: UserCardProps) {
  // implementation
}
```

### Inline Comments

**✅ DO: Use comments for complex logic**

```typescript
// Calculate the running balance by iterating through transactions
// in chronological order and accumulating debits/credits
const balances = transactions.reduce((acc, transaction) => {
  const previousBalance = acc[acc.length - 1]?.balance ?? 0
  const newBalance = previousBalance + transaction.amount
  return [...acc, { ...transaction, balance: newBalance }]
}, [])
```

**❌ DON'T: Use obvious comments**

```typescript
// Increment count
setCount(count + 1)

// Set loading to true
setIsLoading(true)
```

## Performance

### Memoization

**✅ DO: Memoize expensive components**

```typescript
const UserList = React.memo(function UserList({ users }: UserListProps) {
  return (
    <ul>
      {users.map(user => (
        <UserItem key={user.id} user={user} />
      ))}
    </ul>
  )
})
```

**✅ DO: Use `useCallback` for event handlers passed to memoized components**

```typescript
function UserManager() {
  const handleDelete = useCallback((id: string) => {
    // delete logic
  }, [])

  return <UserList onDelete={handleDelete} />
}
```

### Code Splitting

**✅ DO: Use React.lazy for route-based code splitting**

```typescript
const Accounting = React.lazy(() => import('./modules/Accounting'))
const Sales = React.lazy(() => import('./modules/Sales'))

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/accounting" element={<Accounting />} />
        <Route path="/sales" element={<Sales />} />
      </Routes>
    </Suspense>
  )
}
```

## Testing

### Component Testing

**✅ DO: Write tests for complex components**

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('calls onClick when clicked', () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click me</Button>)

    fireEvent.click(screen.getByText('Click me'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('disables button when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>)

    expect(screen.getByText('Click me')).toBeDisabled()
  })
})
```

## Summary

- Use TypeScript with strict types
- Write functional components with hooks
- Organize code by feature/domain
- Use descriptive names
- Extract complex logic into custom hooks
- Use Tailwind CSS for styling
- Document complex code with JSDoc
- Memoize expensive components
- Write tests for complex components

This guide should be reviewed and updated regularly as the project evolves.
