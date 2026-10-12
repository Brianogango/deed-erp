/**
 * The Deed Technologies Credit Application Form and Payment Policy Acceptance
 * Form as fields — shared by the staff screen and the client's link.
 */

export type FieldDef = { key: string; label: string; type?: 'text' | 'email' | 'date' | 'number' | 'textarea' }
export const BUSINESS_FIELDS: FieldDef[] = [
  { key: 'registeredName', label: 'Registered business name' },
  { key: 'tradingName', label: 'Trading name' },
  { key: 'physicalAddress', label: 'Physical address' },
  { key: 'postalAddress', label: 'Postal address (incl. postal code)' },
  { key: 'city', label: 'City' },
  { key: 'telephone', label: 'Telephone number' },
  { key: 'cellphone', label: 'Cellphone number' },
  { key: 'email', label: 'Email address', type: 'email' },
  { key: 'website', label: 'Website' },
  { key: 'incorporationDate', label: 'Date of incorporation', type: 'date' },
  { key: 'incorporationNumber', label: 'Certificate of incorporation no.' },
  { key: 'vatNumber', label: 'VAT number' },
  { key: 'taxPin', label: 'Tax PIN' },
  { key: 'natureOfBusiness', label: 'Nature of business', type: 'textarea' },
  { key: 'employees', label: 'Total number of employees', type: 'number' },
]
export const BUSINESS_TYPES = [
  ['public_limited', 'Public limited company'], ['private_limited', 'Private limited company'], ['sole_proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership'], ['society', 'Society'], ['foreign_branch', 'Registered branch of a foreign-registered company'],
]
export type GroupDef = { key: string; title: string; min: number; max: number; fields: FieldDef[]; note?: string }
export const GROUPS: GroupDef[] = [
  { key: 'directors', title: 'Owners / directors / partners / shareholders', min: 2, max: 10, fields: [
    { key: 'fullName', label: 'Full name (as per ID / passport)' }, { key: 'citizenship', label: 'Citizenship / nationality' },
    { key: 'idNumber', label: 'ID / passport number' }, { key: 'residentialAddress', label: 'Residential address' },
    { key: 'email', label: 'Email', type: 'email' }, { key: 'cellphone', label: 'Cellphone' },
  ] },
  { key: 'poSignatories', title: 'Authorised purchase order signatories', min: 2, max: 4, fields: [
    { key: 'fullName', label: 'Full name' }, { key: 'title', label: 'Designation / title' },
  ], note: 'Purchase orders must be in writing on the company letterhead.' },
  { key: 'banks', title: 'Bank accounts', min: 2, max: 2, fields: [
    { key: 'bankName', label: 'Bank name' }, { key: 'branch', label: 'Branch' }, { key: 'accountNumber', label: 'Account number' },
  ] },
  { key: 'tradeReferences', title: 'Trade / supplier references', min: 2, max: 3, fields: [
    { key: 'supplierName', label: 'Supplier name' }, { key: 'address', label: 'Address' }, { key: 'creditLimit', label: 'Credit limit' },
    { key: 'paymentTerms', label: 'Payment terms' }, { key: 'contactPerson', label: 'Contact person' }, { key: 'designation', label: 'Designation' },
    { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Telephone' },
  ] },
  { key: 'declarationSignatories', title: 'Customer declaration — authorised signatories', min: 2, max: 2, fields: [
    { key: 'fullName', label: 'Full name' }, { key: 'title', label: 'Designation / title' }, { key: 'idNumber', label: 'ID / passport number' },
  ], note: 'Signature and company stamp go on the signed form uploaded under Documents.' },
]
export const STAKEHOLDERS = [
  ['managingDirector', 'Managing director'], ['financialController', 'Financial controller (receives statements)'],
  ['purchasingManager', 'Purchasing manager'], ['salesManager', 'Sales manager'],
]
export const PAYMENT_METHODS = [['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['mobile_money', 'Mobile money']]


export const PAYMENT_POLICY_TERMS = [
  'Payment upon receipt for initial transactions.',
  'Credit terms to be evaluated and offered after at least three successful transactions.',
  'Any late payments may incur fees and affect our credit status with Deed Technologies.',
  'All payments to be made via the specified methods.',
]

export const DECLARATION_TEXT = "By submitting this application, I/We confirm that the information provided is accurate and true. I/We also agree to comply with Deed Technologies' terms and conditions for credit facilities."

// ── What the client's link may save ─────────────────────────────────────────

const SHORT_TEXT = 300
const LONG_TEXT = 2000
const STAKEHOLDER_FIELDS = ['name', 'email', 'phone']

/**
 * Text as typed, minus anything that is not ordinary text: control
 * characters (line breaks kept for long answers) and angle brackets, so a
 * value can never carry HTML into an email, PDF or screen. Capped in length.
 */
function cleanText(value: unknown, max: number, multiline = false): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
    .replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
  return text.slice(0, max)
}

/**
 * The client's form reduced to the fields the form actually has: unknown
 * keys are dropped, every value is plain text of a sensible length, lists
 * keep at most their form's number of rows, choices only take listed values.
 */
export function sanitizeClientForm(input: unknown): Record<string, unknown> {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const out: Record<string, unknown> = {}
  for (const def of BUSINESS_FIELDS) {
    const v = cleanText(src[def.key], def.type === 'textarea' ? LONG_TEXT : SHORT_TEXT, def.type === 'textarea')
    if (v !== undefined) out[def.key] = v
  }
  if (typeof src.businessType === 'string' && (src.businessType === '' || BUSINESS_TYPES.some(([k]) => k === src.businessType))) {
    out.businessType = src.businessType
  }
  for (const group of GROUPS) {
    const rows = src[group.key]
    if (!Array.isArray(rows)) continue
    out[group.key] = rows.slice(0, group.max).map(row => {
      const r = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {}
      const clean: Record<string, string> = {}
      for (const f of group.fields) {
        const v = cleanText(r[f.key], SHORT_TEXT)
        if (v !== undefined) clean[f.key] = v
      }
      return clean
    })
  }
  if (src.stakeholders && typeof src.stakeholders === 'object' && !Array.isArray(src.stakeholders)) {
    const s = src.stakeholders as Record<string, unknown>
    const clean: Record<string, Record<string, string>> = {}
    for (const [key] of STAKEHOLDERS) {
      const person = s[key]
      if (!person || typeof person !== 'object' || Array.isArray(person)) continue
      const p: Record<string, string> = {}
      for (const f of STAKEHOLDER_FIELDS) {
        const v = cleanText((person as Record<string, unknown>)[f], SHORT_TEXT)
        if (v !== undefined) p[f] = v
      }
      clean[key] = p
    }
    out.stakeholders = clean
  }
  if (Array.isArray(src.paymentMethods)) {
    out.paymentMethods = [...new Set(src.paymentMethods.filter(m => PAYMENT_METHODS.some(([k]) => k === m)))]
  }
  if (typeof src.policyAccepted === 'boolean') out.policyAccepted = src.policyAccepted
  if (typeof src.policyAcceptedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.policyAcceptedOn)) out.policyAcceptedOn = src.policyAcceptedOn
  if (typeof src.declarationAccepted === 'boolean') out.declarationAccepted = src.declarationAccepted
  return out
}
