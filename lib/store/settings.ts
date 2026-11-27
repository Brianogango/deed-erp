import type { CategoryId } from '@/lib/product-categories'
import type { PricingMarginPolicy } from '@/lib/pricing/margin-policy'

export interface CompanySettings {
  name: string
  legalName?: string
  address: string
  streetAddress?: string
  city: string
  county?: string
  postalCode?: string
  country?: string
  language?: string
  timezone?: string
  phone: string
  email: string
  website: string
  kraPin: string
  vatRate: number
  mpesaPaybill: string
  mpesaAccount: string
  logoUrl: string
  /** Document default / display currency. Books remain KES (functionalCurrency). */
  currency: string
  /** Always KES — accounting / trial balance functional currency. */
  functionalCurrency?: 'KES'
  invoiceFooter: string
  /** Odoo Configure Document Layout values used by all commercial PDFs. */
  printTemplate?: import('@/lib/document-layout').DocumentLayoutId | 'classic' | 'light' | 'modern' | 'compact'
  printFont?: import('@/lib/document-layout').DocumentFontId
  printBackground?: import('@/lib/document-layout').DocumentBackgroundId
  printPrimaryColor?: string
  printSecondaryColor?: string
  printTagline?: string
  printPaperFormat?: import('@/lib/document-layout').DocumentPaperFormat
  /**
   * Product category names hidden from the public partner catalog
   * (GET /api/public/v1/products). Case-insensitive. Lets the merchant keep
   * whole categories such as Parts / Components / Accessories out of the
   * reseller feed without touching individual products. Empty/unset = show all.
   */
  partnerHiddenCategories?: string[]
}

export interface SystemSettings {
  // General
  multiUserRoles: boolean
  enforceDeptAccess: boolean
  auditLogs: boolean
  fiscalYearStart: string
  // CRM
  crmLeads: boolean
  crmLeadScoring: boolean
  crmTags: boolean
  crmSourceTracking: boolean
  crmPipelineStages: string[]
  crmEnforceNextActivity: boolean
  crmAutoAssignLeads: boolean
  crmAutoFollowUpAfterQuote: boolean
  // Sales
  salesQuotationTemplates: boolean
  salesOptionalProducts: boolean
  salesDigitalSignature: boolean
  salesOnlineAcceptance: boolean
  salesPricelists: boolean
  salesDiscountControl: boolean
  salesConfirmedQuotesToOrders: boolean
  /** Odoo "Lock Confirmed Sales": confirmed orders freeze commercial fields. */
  salesLockConfirmed: boolean
  /**
   * Minimum gross-margin % on quotation lines (after discount) before
   * special_pricing approval is required. Floor price remains product cost.
   * Detection stays even while `salesRequireSpecialPricingApproval` is off.
   */
  salesMinMarginPercent: number
  /**
   * When true, selling below cost / lowest selling point / pricelist requires
   * Director or Finance (`special_pricing`) before confirm. Default false =
   * on hold; the ladder is kept, not deleted.
   */
  salesRequireSpecialPricingApproval: boolean
  /**
   * When true, exceeding available customer credit requires Finance
   * (`credit_override`; Director as well above KES 100k) before confirm.
   * Default false = on hold; the ladder is kept, not deleted.
   */
  salesRequireCreditOverrideApproval: boolean
  // Inventory
  invProductsMasterOnly: boolean
  invNoDirectStockEdits: boolean
  invMultiStepRoutes: boolean
  invStorageLocations: string[]
  invSerialNumbers: boolean
  invLots: boolean
  invAutomatedValuation: boolean
  invCostingMethod: 'fifo' | 'average' | 'standard'
  /** Default low-stock alert threshold when a new product does not set one. */
  invDefaultMinStock: number
  /** Default warranty period (months) when a new product does not set one. */
  invDefaultWarrantyMonths: number
  /** Test bench checklist (Settings › Inventory). Unset: the built-in list. */
  invUnitTestChecklist?: Array<{ id: string; label: string; short: string; laptopOnly?: boolean; inactive?: boolean }>
  /** A laptop fails its test below this battery health %. Unset: 60. */
  invBatteryFailBelow?: number
  /** Passes, but the label calls the battery out, below this %. Unset: 80. */
  invBatteryNoteBelow?: number
  /** Feature flag for Device Reconfiguration work orders. Default true when unset. */
  reconfigurationEnabled: boolean
  /**
   * Minimum gross-margin % required after reconfiguration without finance override.
   */
  reconfigurationMinMarginPct: number
  /**
   * Legacy per-category markup % (sale = cost × (1 + pct/100)).
   * Used only when margin policy is disabled or a category is unmapped.
   */
  invCategorySaleMarkupPct: Partial<Record<CategoryId, number>>
  /**
   * Deed margin-from-cost policy (overhead + category GP bands + price tiers).
   * Source of truth for Inventory sale suggestions and sales margin floors.
   */
  pricingMarginPolicy: PricingMarginPolicy
  // Purchase
  purPurchaseAgreements: boolean
  purVendorPricelists: boolean
  /** @deprecated Unused. High-value PO director approval was removed. */
  purRequireApprovalHighValue: boolean
  /** @deprecated Unused. High-value PO director approval was removed. */
  purHighValueThreshold: number
  purEnforceRFQFlow: boolean
  purStoreLeadTimes: boolean
  /** Vendor bill due-date fallback when the vendor record sets no terms. */
  purDefaultPaymentTermsDays: number
  /**
   * Payment policy enforcement: corporate customers without approved credit
   * pay on receipt — no new order or invoice while money is owed, invoices
   * due on the day. Off until existing balances are sorted out.
   */
  accCreditPayOnReceiptEnforced?: boolean
  // Repair
  repRepairOrders: boolean
  repWarrantyTracking: boolean
  repPartsConsumption: boolean
  repEnforceFlow: boolean
  repOnlyAssignedTechSeesJob: boolean
  repAdminAssignsJobs: boolean
  /** Flat Diagnosis First fee (KES) — walk-in & corporate; not credited against labour. */
  diagnosisFeeKes: number
  /** @deprecated Prefer diagnosisFeeKes. */
  diagnosisFeeRegularKes: number
  /** @deprecated Prefer diagnosisFeeKes. */
  diagnosisFeeHighEndKes: number
  // Accounting
  accCustomerInvoices: boolean
  accVendorBills: boolean
  accCreditNotes: boolean
  accVatEnabled: boolean
  accBankJournals: boolean
  accMpesaJournals: boolean
  accReconciliation: boolean
  accLockDates: boolean
  accApprovalForRefunds: boolean
  // HR
  hrAttendance: boolean
  /** Working days after its date before a cheque clears (default 2). */
  chequeClearingDays?: number
  hrLeaves: boolean
  hrRestrictSalaryInfo: boolean
  hrRoleBasedVisibility: boolean
  // POS
  posSessionControl: boolean
  posCashControl: boolean
  posReceiptPrinting: boolean
  /** Loyalty earn rate: 1 point per this many KES spent (1 point = 1 KES on redemption). */
  posLoyaltyKesPerPoint: number
  // Security
  secDisableProductDeletion: boolean
  secDisableStockManipulation: boolean
  secDisableInvoiceEditAfterValidation: boolean
  // When true (default), customers must enter the phone number on file to approve a quote
  // or confirm payment through the portal. Set false only to temporarily reduce friction.
  secPortalRequirePhoneVerification: boolean
  /**
   * @deprecated Unused for Admin Officer post/pay. Kept as the SoD threshold
   * (poster cannot also pay above this amount unless Director).
   */
  accAdminOfficerInvoiceLimitKes: number
}
