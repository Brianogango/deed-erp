'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CompanySettings, Contact, Product, SaleOrder } from '@/lib/store'

const DISMISS_KEY = 'deed_onboarding_dismissed'

type ChecklistItem = {
  id: string
  label: string
  done: boolean
  path: string
}

function isCompanyConfigured(settings: CompanySettings): boolean {
  return Boolean(
    settings.name?.trim() &&
      settings.address?.trim() &&
      (settings.phone?.trim() || settings.email?.trim()),
  )
}

export function useOnboardingState({
  companySettings,
  accounts,
  products,
  contacts,
  saleOrders,
}: {
  companySettings: CompanySettings
  accounts: { isActive?: boolean }[]
  products: Product[]
  contacts: Contact[]
  saleOrders: SaleOrder[]
}) {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  const items = useMemo<ChecklistItem[]>(() => [
    {
      id: 'company',
      label: 'Company settings filled in',
      done: isCompanyConfigured(companySettings),
      path: '/settings?tab=company',
    },
    {
      id: 'coa',
      label: 'Chart of accounts ready',
      done: accounts.some(a => a.isActive !== false),
      path: '/finance?tab=accounts',
    },
    {
      id: 'product',
      label: 'First product created',
      done: products.length > 0,
      path: '/operations?tab=products',
    },
    {
      id: 'contact',
      label: 'First customer or contact added',
      done: contacts.length > 0,
      path: '/contacts',
    },
    {
      id: 'quotation',
      label: 'First quotation created',
      done: saleOrders.some(o => o.status === 'quotation' || o.status === 'quotation_sent'),
      path: '/sales',
    },
  ], [companySettings, accounts, products, contacts, saleOrders])

  const complete = items.every(i => i.done)
  const visible = !dismissed && !complete

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
  }

  return { items, complete, visible, dismiss }
}

export function OnboardingChecklist({
  companySettings,
  accounts,
  products,
  contacts,
  saleOrders,
  onNavigate,
}: {
  companySettings: CompanySettings
  accounts: { isActive?: boolean }[]
  products: Product[]
  contacts: Contact[]
  saleOrders: SaleOrder[]
  onNavigate?: (path: string) => void
}) {
  const router = useRouter()
  const { items, visible, dismiss } = useOnboardingState({
    companySettings,
    accounts,
    products,
    contacts,
    saleOrders,
  })

  if (!visible) return null

  const go = (path: string) => {
    if (onNavigate) onNavigate(path)
    else router.push(path)
  }

  const doneCount = items.filter(i => i.done).length

  return (
    <section className="dashboard-panel overflow-hidden onboarding-checklist">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-[var(--border-lt)]">
        <div>
          <h3 className="text-[15px] font-extrabold text-[var(--text-1)]">Getting started</h3>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {doneCount} of {items.length} setup steps complete
          </p>
        </div>
        <button type="button" className="btn-ghost text-xs self-start sm:self-auto" onClick={dismiss}>
          Dismiss
        </button>
      </div>
      <ul className="p-4 flex flex-col gap-2">
        {items.map(item => (
          <li key={item.id}>
            <button
              type="button"
              className={`onboarding-checklist-item ${item.done ? 'is-done' : ''}`}
              onClick={() => !item.done && go(item.path)}
              disabled={item.done}
            >
              <span className="onboarding-checklist-mark" aria-hidden="true">
                {item.done ? '✓' : '○'}
              </span>
              <span className="text-sm text-[var(--text-2)]">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
