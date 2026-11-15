import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useHrStore as useHrDomainStore } from '@/hooks/useHrStore'
import { bootApiGroupsForRoute, STORE_KEY_BOOT_GROUPS, type BootApiGroup } from '@/lib/boot-apis'
import { fetchCollection } from '@/lib/api-pagination'
import { userCan } from '@/lib/auth/can'
import { fetchAndApplyStoreKeys } from '@/lib/client-store-hydrate'
import { preferExistingArray } from '@/lib/safe-local-state'
import { scheduleCatalogHealOnce } from '@/lib/catalog-boot-heal'
import type { User } from './core'
import type { JournalEntry } from './finance'
import type { Employee, PayrollRun, Payslip, SalaryAdvance } from './hr'

type ApprovalRule = { approvalType: string; thresholds: { maxValue: number; requiredRoles: string[] }[]; isActive: boolean }

export type BootApiDeps = {
  initialUser: User | null | undefined
  refreshProductCatalog: () => unknown
  /** Groups already fetched this session, so a route change does not refetch them. */
  bootedApiGroupsRef: MutableRefObject<Set<BootApiGroup>>
  setDbApprovalRules: Dispatch<SetStateAction<ApprovalRule[]>>
  setJournalEntries: Dispatch<SetStateAction<JournalEntry[]>>
  setPayrollRuns: Dispatch<SetStateAction<PayrollRun[]>>
  setPayslips: Dispatch<SetStateAction<Payslip[]>>
  setSalaryAdvances: Dispatch<SetStateAction<SalaryAdvance[]>>
}

/**
 * Boot fetches, per route. A screen pulls only the collections it needs, once
 * per session, and leave requests are polled only while the HR workspace is open.
 */
export function useBootApis({
  initialUser,
  refreshProductCatalog,
  bootedApiGroupsRef,
  setDbApprovalRules,
  setJournalEntries,
  setPayrollRuns,
  setPayslips,
  setSalaryAdvances,
}: BootApiDeps) {
  useEffect(() => {
    if (!initialUser) return

    const fetchLeave = () => fetch('/api/leave-requests').then(r => (r.ok ? r.json() : null)).then(data => {
      if (data?.requests) useHrDomainStore.getState().setLeaveRequests(data.requests)
      if (data?.balances) useHrDomainStore.getState().setLeaveBalances(data.balances)
    }).catch(() => {})

    const runGroup = async (group: BootApiGroup) => {
      if (bootedApiGroupsRef.current.has(group)) return
      bootedApiGroupsRef.current.add(group)
      try {
        switch (group) {
          case 'products': {
            refreshProductCatalog()
            break
          }
          case 'employees': {
            const d = await fetchCollection('/api/employees?limit=200')
            const prev = useHrDomainStore.getState().employees ?? []
            useHrDomainStore.getState().setEmployees(preferExistingArray(prev, d) as Employee[])
            break
          }
          case 'leave':
            await fetchLeave()
            break
          case 'payroll': {
            if (!userCan(initialUser, 'managePayroll')) break
            const [data, paymentJournalData] = await Promise.all([
              fetch('/api/payroll').then(r => r.ok ? r.json() : null),
              fetch('/api/accounting/journals?source=payroll_payment&limit=500').then(r => r.ok ? r.json() : null),
            ])
            if (data?.runs) setPayrollRuns(data.runs)
            if (data?.payslips) setPayslips(data.payslips)
            const paymentJournals = Array.isArray(paymentJournalData?.journals)
              ? paymentJournalData.journals as JournalEntry[]
              : []
            if (paymentJournals.length > 0) {
              setJournalEntries(prev => {
                const authoritativeRefs = new Set(paymentJournals.map(j => j.ref))
                return [...paymentJournals, ...prev.filter(j => !authoritativeRefs.has(j.ref))]
              })
            }
            break
          }
          case 'salary_advances': {
            const data = await fetch('/api/salary-advances').then(r => r.ok ? r.json() : null)
            if (Array.isArray(data)) setSalaryAdvances(data)
            break
          }
          case 'approval_rules': {
            const data = await fetch('/api/settings/approval-rules').then(r => r.ok ? r.json() : [])
            if (Array.isArray(data)) setDbApprovalRules(data)
            break
          }
        }
      } catch {
        bootedApiGroupsRef.current.delete(group)
      }
    }

    /** Every store-key group for a route in one download, then the rest. */
    const runGroups = async (groups: BootApiGroup[]) => {
      const keyGroups = groups.filter(g => STORE_KEY_BOOT_GROUPS[g] && !bootedApiGroupsRef.current.has(g))
      const keys = [...new Set(keyGroups.flatMap(g => STORE_KEY_BOOT_GROUPS[g] ?? []))]
      if (keys.length) {
        keyGroups.forEach(g => bootedApiGroupsRef.current.add(g))
        void fetchAndApplyStoreKeys({ keys }).then(
          result => { if (result === 'error') keyGroups.forEach(g => bootedApiGroupsRef.current.delete(g)) },
          () => keyGroups.forEach(g => bootedApiGroupsRef.current.delete(g)),
        )
      }
      await Promise.all(groups.filter(g => !STORE_KEY_BOOT_GROUPS[g]).map(runGroup))
    }

    const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
    void runGroups(bootApiGroupsForRoute(path))
    scheduleCatalogHealOnce()

    // Leave lists belong on HR. Polling them on every screen re-fetched
    // employees/balances while the user was on Sales or Finance.
    let leaveInterval: ReturnType<typeof setInterval> | undefined
    const canPollLeave = userCan(initialUser, 'manageHR')
    const startLeavePoll = (nextPath: string) => {
      if (!canPollLeave || !nextPath.startsWith('/hr') || leaveInterval) return
      leaveInterval = setInterval(fetchLeave, 60_000)
    }
    const stopLeavePoll = () => {
      if (!leaveInterval) return
      clearInterval(leaveInterval)
      leaveInterval = undefined
    }
    startLeavePoll(path)

    const onRoute = (e: Event) => {
      const nextPath = (e as CustomEvent).detail?.pathname
      if (typeof nextPath !== 'string') return
      void runGroups(bootApiGroupsForRoute(nextPath))
      if (nextPath.startsWith('/hr')) startLeavePoll(nextPath)
      else stopLeavePoll()
    }
    window.addEventListener('deed_route_change', onRoute as EventListener)

    return () => {
      stopLeavePoll()
      window.removeEventListener('deed_route_change', onRoute as EventListener)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUser?.id, initialUser?.role, refreshProductCatalog])
}
