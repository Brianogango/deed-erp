'use client'

export { useProducts, revalidateProducts } from './use-products'
export { makeResourceHook, revalidateResource } from './use-store-resource'

import { makeResourceHook, revalidateResource } from './use-store-resource'
import type {
  SaleOrder, RepairOrder, Invoice,
  Company, Contact, Employee,
} from '@/lib/store'

export const useSaleOrders   = makeResourceHook<SaleOrder>('/api/sale-orders')
export const useRepairs       = makeResourceHook<RepairOrder>('/api/repairs')
export const useInvoices      = makeResourceHook<Invoice>('/api/invoices')
export const useCompanies     = makeResourceHook<Company>('/api/companies')
export const useContacts      = makeResourceHook<Contact>('/api/contacts')
export const useEmployees     = makeResourceHook<Employee>('/api/employees')

// Cross-resource invalidation helpers
export const revalidateSaleOrders    = () => revalidateResource('/api/sale-orders')
export const revalidateRepairs       = () => revalidateResource('/api/repairs')
export const revalidateInvoices      = () => revalidateResource('/api/invoices')
export const revalidateCompanies     = () => revalidateResource('/api/companies')
export const revalidateContacts      = () => revalidateResource('/api/contacts')
export const revalidateEmployees     = () => revalidateResource('/api/employees')
