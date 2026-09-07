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
      path: '/inventory?tab=products',
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
  const nextItem = items.find(item => !item.done)
  const progress = Math.round((doneCount / items.length) * 100)

  return (
    <section className="dashboard-setup-strip" aria-label="Workspace setup">
      <div className="dashboard-setup-summary">
        <span className="dashboard-setup-title">Workspace setup</span>
        <span className="dashboard-setup-count">{doneCount} of {items.length} complete</span>
      </div>
      <div
        className="dashboard-setup-progress"
        role="progressbar"
        aria-label="Workspace setup progress"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={doneCount}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      {nextItem && (
        <button
          type="button"
          className="dashboard-setup-continue"
          onClick={() => go(nextItem.path)}
        >
          Continue setup
          <span aria-hidden="true">›</span>
        </button>
      )}
      <button
        type="button"
        className="dashboard-setup-dismiss"
        onClick={dismiss}
        aria-label="Dismiss workspace setup"
        title="Dismiss"
      >
        ×
      </button>
    </section>
  )
}
