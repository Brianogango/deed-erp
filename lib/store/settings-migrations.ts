import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { needsDiagnosisFeeSettingsMigration, migratedDiagnosisFeeSettings } from '@/lib/diagnosis-fee'
import { normalizePricingMarginPolicy } from '@/lib/pricing/margin-policy'
import type { CompanySettings, SystemSettings } from './settings'

/**
 * One-time rewrites of settings already saved in a browser, applied once on
 * mount. Each reads the stored value as it was at boot and writes through a
 * functional update, so a tenant that has already been migrated is untouched.
 */
export function useStoredSettingsMigrations(
  companySettings: CompanySettings,
  setCompanySettings: Dispatch<SetStateAction<CompanySettings>>,
  systemSettings: SystemSettings,
  setSystemSettings: Dispatch<SetStateAction<SystemSettings>>,
) {
  useEffect(() => {
    // Replace the temporary Odoo demo palette shipped by the first layout pass.
    // Preserve any genuinely custom colours selected later.
    const primary = String(companySettings.printPrimaryColor || '').toUpperCase()
    const secondary = String(companySettings.printSecondaryColor || '').toUpperCase()
    if ((!primary || primary === '#714B67') && (!secondary || secondary === '#017E84')) {
      setCompanySettings(previous => ({ ...previous, printPrimaryColor: '#1B2762', printSecondaryColor: '#00AEEF' }))
    }

    // Previous default was 100_000 with no settings UI; raise stored value to 1_000_000.
    if (systemSettings.accAdminOfficerInvoiceLimitKes === 100000) {
      setSystemSettings(prev => ({ ...prev, accAdminOfficerInvoiceLimitKes: 1000000 }))
    }

    // High-value PO director approval was removed; clear tenants that still have it on.
    if (systemSettings.purRequireApprovalHighValue) {
      setSystemSettings(prev => ({ ...prev, purRequireApprovalHighValue: false }))
    }

    // Legacy diagnosis fee tiers (1,500 / 2,500) become a flat KES 1,000.
    if (needsDiagnosisFeeSettingsMigration(systemSettings)) {
      setSystemSettings(prev => ({ ...prev, ...migratedDiagnosisFeeSettings(prev) }))
    }

    // Margin policy always carries the spreadsheet defaults when missing or partial.
    const normalized = normalizePricingMarginPolicy(systemSettings.pricingMarginPolicy)
    const storedPolicy = systemSettings.pricingMarginPolicy
    if (!storedPolicy || JSON.stringify(storedPolicy) !== JSON.stringify(normalized)) {
      setSystemSettings(prev => ({ ...prev, pricingMarginPolicy: normalized }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
