
'use client'

/**
 * NOT the ERP source of truth for company settings.
 * lib/store.tsx + /api/settings own VAT, banks, logo, and company identity.
 * Do not mount this persist store as a second settings SoT.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StateCreator } from 'zustand'
import { uid, now } from '@/lib/utils'

interface CompanySettings {
  id: string
  logoUrl: string
  companyName: string
  footerText: string
  vatRate: number
  currency: string
  address: string
  phone: string
  email: string
  updatedAt: string
}

interface BankAccount {
  id: string
  name: string
  bankName: string
  accountNo: string
  openingBalance: number
  active: boolean
}

export interface CompanyDocument {
  id: string
  name: string
  fileName: string
  category: 'sop' | 'policy' | 'contract' | 'other'
  data: string       // base64 data URL
  uploadedAt: string
  uploadedBy: string
  size: number       // bytes
}

interface SettingsState {
  company: CompanySettings
  banks: BankAccount[]
  documents: CompanyDocument[]
  updateCompany: (settings: Partial<CompanySettings>) => void
  addBank: (bank: Omit<BankAccount, 'id'>) => BankAccount
  updateBank: (id: string, updates: Partial<BankAccount>) => void
  toggleBank: (id: string) => void
  addDocument: (doc: Omit<CompanyDocument, 'id'>) => void
  deleteDocument: (id: string) => void
  reset: () => void
}

const createSettingsStore: StateCreator<SettingsState> = (set, get) => ({
  documents: [],
  addDocument: (doc) => set((state) => ({
    documents: [{ ...doc, id: uid() }, ...state.documents],
  })),
  deleteDocument: (id) => set((state) => ({
    documents: state.documents.filter(d => d.id !== id),
  })),
  company: {
    id: 'default',
    logoUrl: '/logo.png',
    companyName: 'Deed Technologies Ltd',
    footerText: 'Nairobi, Kenya | +254 700 123456',
    vatRate: 16,
    currency: 'KES',
    address: 'P.O. Box 12345-00100, Nairobi',
    phone: '+254700123456',
    email: 'info@deed.co.ke',
    updatedAt: now(),
  },
  banks: [
    { id: 'ncba', name: 'NCBA Current', bankName: 'NCBA Bank Kenya', accountNo: '1005157785', openingBalance: 1640000, active: true },
    { id: 'equity', name: 'Equity Business', bankName: 'Equity Bank Kenya', accountNo: '0670200000', openingBalance: 490000, active: true },
  ],
  updateCompany: (settings) => set((state) => ({
    company: { ...state.company, ...settings, updatedAt: now() }
  })),
  addBank: (bank) => {
    const newBank = { ...bank, id: uid() }
    set((state) => ({ banks: [...state.banks, newBank] }))
    return newBank
  },
  updateBank: (id, updates) => set((state) => ({
    banks: state.banks.map(b => b.id === id ? { ...b, ...updates } : b)
  })),
  toggleBank: (id) => set((state) => ({
    banks: state.banks.map(b => b.id === id ? { ...b, active: !b.active } : b)
  })),
  reset: () => set({
    company: {
      id: 'default',
      logoUrl: '/logo.png',
      companyName: 'Deed Technologies Ltd',
      footerText: 'Nairobi, Kenya | +254 700 123456',
      vatRate: 16,
      currency: 'KES',
      address: 'P.O. Box 12345-00100, Nairobi',
      phone: '+254700123456',
      email: 'info@deed.co.ke',
      updatedAt: now(),
    },
    banks: [
      { id: 'ncba', name: 'NCBA Current', bankName: 'NCBA Bank Kenya', accountNo: '1005157785', openingBalance: 1640000, active: true },
      { id: 'equity', name: 'Equity Business', bankName: 'Equity Bank Kenya', accountNo: '0670200000', openingBalance: 490000, active: true },
    ]
  })
})

export const useSettingsStore = create(
  persist(createSettingsStore, {
    name: 'deed-settings',
  })
)

