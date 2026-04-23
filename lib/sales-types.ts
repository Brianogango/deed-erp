// ─── Comprehensive Sales & CRM Types ──────────────────────────────────────────

export type OpportunityStage =
  | 'prospecting'        // Initial contact made
  | 'qualification'      // Needs assessment, budget discussion
  | 'proposal'           // Quote/proposal sent
  | 'negotiation'        // Terms being discussed
  | 'closed_won'         // Deal won, converted to sale
  | 'closed_lost'        // Deal lost
  | 'on_hold'            // Temporarily paused

export type LeadSource =
  | 'website'
  | 'referral'
  | 'cold_call'
  | 'email_campaign'
  | 'social_media'
  | 'trade_show'
  | 'partner'
  | 'existing_customer'
  | 'walk_in'

export type QuoteStatus =
  | 'draft'              // Being prepared
  | 'sent'               // Sent to customer
  | 'viewed'             // Customer viewed quote
  | 'accepted'           // Customer accepted
  | 'rejected'           // Customer rejected
  | 'expired'            // Past valid date
  | 'revised'            // New version created

export interface Company {
  id: string
  name: string
  tradingName?: string
  registrationNumber?: string
  taxId: string          // PIN/VAT number
  industry?: string
  employees?: number
  annualRevenue?: number
  
  // Contact
  email: string
  phone: string
  website?: string
  
  // Address
  physicalAddress: string
  postalAddress?: string
  city: string
  country: string
  
  // Business Details
  paymentTerms: number   // Days (e.g., 30, 60)
  creditLimit: number
  creditUsed: number
  
  // Relationships
  accountManagerId?: string
  accountManagerName?: string
  parentCompanyId?: string
  
  // Tags & Segments
  tags: string[]
  segment?: 'enterprise' | 'sme' | 'startup' | 'government'
  
  // Status
  status: 'active' | 'inactive' | 'suspended'
  kycStatus: 'pending' | 'verified' | 'rejected'
  
  // Metadata
  createdDate: string
  createdBy: string
  lastContactDate?: string
  notes?: string
}

export interface ContactPerson {
  id: string
  companyId: string
  companyName: string
  
  // Personal Info
  firstName: string
  lastName: string
  fullName: string
  jobTitle: string
  department?: string
  
  // Contact
  email: string
  phone: string
  mobile?: string
  
  // Role
  isPrimary: boolean
  isDecisionMaker: boolean
  isBillingContact: boolean
  isTechnicalContact: boolean
  
  // Preferences
  preferredChannel: 'email' | 'phone' | 'whatsapp'
  timezone?: string
  
  // Social
  linkedIn?: string
  
  // Metadata
  createdDate: string
  lastContactDate?: string
  notes?: string
}

export interface Opportunity {
  id: string
  ref: string
  name: string
  
  // Customer
  companyId: string
  companyName: string
  contactPersonId: string
  contactPersonName: string
  
  // Sales Rep
  ownerId: string
  ownerName: string
  
  // Pipeline
  stage: OpportunityStage
  probability: number    // 0-100%
  expectedValue: number
  actualValue: number
  
  // Dates
  createdDate: string
  expectedCloseDate: string
  actualCloseDate?: string
  lastActivityDate?: string
  
  // Source
  leadSource: LeadSource
  campaign?: string
  
  // Details
  description: string
  customerNeeds?: string
  competitorInfo?: string
  
  // Linked Records
  quoteIds: string[]
  saleOrderId?: string
  
  // Outcome
  lostReason?: string
  lostToCompetitor?: string
  
  // Tags
  tags: string[]
  
  // Metadata
  notes?: string
}

export interface QuoteRevision {
  id: string
  quoteId: string
  version: number
  createdDate: string
  createdBy: string
  changes: string
}

export interface Quote {
  id: string
  ref: string
  version: number
  status: QuoteStatus
  
  // Linked Entities
  opportunityId: string
  opportunityName: string
  companyId: string
  companyName: string
  contactPersonId: string
  contactPersonName: string
  
  // Sales Rep
  createdBy: string
  createdByName: string
  ownerId: string
  ownerName: string
  
  // Validity
  issueDate: string
  validUntil: string
  expiryWarningDays: number
  
  // Line Items
  lines: QuoteLineItem[]
  
  // Pricing
  subtotal: number
  discountAmount: number
  discountPercent: number
  taxTotal: number
  total: number
  
  // Terms
  paymentTerms: string
  deliveryTerms?: string
  warranty?: string
  
  // Status Tracking
  sentDate?: string
  viewedDate?: string
  viewCount: number
  acceptedDate?: string
  rejectedDate?: string
  rejectionReason?: string
  expirationDate?: string
  
  // Conversion
  saleOrderId?: string
  convertedDate?: string
  
  // Revisions
  parentQuoteId?: string  // If this is a revision
  revisedBy?: string
  revisionNotes?: string
  
  // Metadata
  notes?: string
  internalNotes?: string
  terms?: string
}

export interface QuoteLineItem {
  id: string
  quoteId: string
  
  // Product
  productId: string
  productName: string
  sku: string
  description?: string
  
  // Quantity & Unit
  qty: number
  unit: string
  
  // Pricing
  listPrice: number      // Original product price
  unitPrice: number      // Actual quoted price
  discount: number       // Percentage
  discountAmount: number // Actual discount in currency
  
  // Tax
  taxRate: number
  taxAmount: number
  
  // Totals
  subtotal: number       // After discount, before tax
  lineTotal: number      // Final amount including tax
  
  // Optional
  notes?: string
  deliveryDate?: string
}

export interface OpportunityActivity {
  id: string
  opportunityId: string
  type: 'call' | 'email' | 'meeting' | 'demo' | 'proposal' | 'note' | 'task'
  subject: string
  description?: string
  outcome?: string
  createdBy: string
  createdByName: string
  createdDate: string
  scheduledDate?: string
  completedDate?: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

export interface SalesPipelineForecast {
  stage: OpportunityStage
  count: number
  value: number
  weightedValue: number  // value × avg(probability)
}

export interface SalesRepPerformance {
  userId: string
  userName: string
  
  // Opportunities
  opportunitiesTotal: number
  opportunitiesWon: number
  opportunitiesLost: number
  winRate: number
  
  // Revenue
  quotedValue: number
  wonValue: number
  avgDealSize: number
  
  // Activity
  activitiesLogged: number
  lastActivityDate?: string
  
  // Pipeline
  pipelineValue: number
  weightedPipelineValue: number
}
