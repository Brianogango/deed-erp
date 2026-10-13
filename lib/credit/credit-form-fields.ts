/**
 * The Deed Technologies "Application for Credit" form (2 pages, sections A–J)
 * as fields — shared by the staff screen and the client's link.
 *
 * Keys keep their earlier names where the meaning is the same (registeredName,
 * directors, tradeReferences, banks, poSignatories…) so applications already
 * in progress keep their answers.
 */

export type FieldDef = { key: string; label: string; type?: 'text' | 'email' | 'date' | 'number' | 'textarea' }

/** A · General details */
export const BUSINESS_FIELDS: FieldDef[] = [
  { key: 'registeredName', label: 'Name of organization' },
  { key: 'physicalAddress', label: 'Address' },
  { key: 'telephone', label: 'Telephone' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'yearEstablished', label: 'Year of establishment', type: 'number' },
  { key: 'permitNumber', label: 'City council permit no.' },
  { key: 'permitExpiry', label: 'Permit expiry date', type: 'date' },
  { key: 'taxPin', label: 'KRA PIN / company no.' },
]
/** A · Legal status */
export const BUSINESS_TYPES = [
  ['llc', 'LLC'], ['company', 'Company'], ['partnership', 'Partnership'], ['proprietorship', 'Proprietorship'],
]

export type GroupDef = { key: string; letter: string; title: string; min: number; max: number; fields: FieldDef[]; note?: string }
export const GROUPS: GroupDef[] = [
  { key: 'directors', letter: 'B', title: 'Details of owner / proprietor / partners', min: 1, max: 6, fields: [
    { key: 'fullName', label: 'Name' }, { key: 'citizenship', label: 'Nationality' },
  ] },
  { key: 'subsidiaries', letter: 'C', title: 'Names and address of subsidiary / associate companies', min: 1, max: 4, fields: [
    { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' },
  ], note: 'If any.' },
  { key: 'tradeReferences', letter: 'D', title: 'Companies you currently enjoy credit facilities from', min: 1, max: 4, fields: [
    { key: 'supplierName', label: 'Name' }, { key: 'contactPerson', label: 'Contact person' }, { key: 'phone', label: 'Mobile / phone' },
    { key: 'creditLimit', label: 'Credit limit' }, { key: 'paymentTerms', label: 'Payment terms' },
  ], note: 'If any.' },
  { key: 'banks', letter: 'F', title: 'Name and address of bankers with account no.', min: 1, max: 3, fields: [
    { key: 'bankName', label: 'Bank name & branch' }, { key: 'accountNumber', label: 'Account no.' },
  ] },
  { key: 'chequeSignatories', letter: 'G', title: 'Authorized signatories for cheques / bills of exchange / other banking documents', min: 1, max: 4, fields: [
    { key: 'fullName', label: 'Name' }, { key: 'title', label: 'Designation' },
  ], note: 'Specimen signatures go on the signed form uploaded under Documents.' },
  { key: 'poSignatories', letter: 'H', title: 'Authorized signatories for LPOs', min: 1, max: 4, fields: [
    { key: 'fullName', label: 'Name' }, { key: 'title', label: 'Designation' },
  ], note: 'Specimen signatures go on the signed form uploaded under Documents.' },
]
/** Sections shown before "E · Details of credit requirement", and after it. */
export const GROUPS_BEFORE_CREDIT = GROUPS.filter(g => g.letter < 'E')
export const GROUPS_AFTER_CREDIT = GROUPS.filter(g => g.letter > 'E')

/** I · General conditions */
export const GENERAL_CONDITIONS = [
  'An interest of 12% will be charged on outstanding amounts beyond the allowed credit period.',
  'Purchases will only be delivered against local purchase orders signed by authorized personnel.',
  'The firm/company will be totally responsible for payment of any materials supplied against LPOs duly signed by authorized personnel, unless adequate notice is given to us in writing cancelling those signatures.',
  'All disputes arising in respect of overdue accounts shall be finally referred to the Kenyan Law Courts for settlement.',
  'This Credit Application is to be signed by the owner of the firm. If it is signed by a person other than the owner, a copy of the authority given to the signatory by the owner(s) must be attached.',
]

export const DECLARATION_TEXT = 'I/We agree to the above conditions and declare that all information given in this application is true and correct.'

/** I · The representative who signs the declaration (signature and stamp go on the signed form). */
export const REPRESENTATIVE_FIELDS: FieldDef[] = [
  { key: 'representativeName', label: 'Representative name' },
  { key: 'representativePhone', label: 'Telephone no.' },
]

/** "For office use only" — staff fill these in; the client's link never saves them. */
export const OFFICE_USE_FIELDS: FieldDef[] = [
  { key: 'officeAccountNo', label: 'Account no.' },
  { key: 'officeProducts', label: 'Product/s' },
  { key: 'officeRemarks', label: 'Remarks', type: 'textarea' },
  { key: 'salesManagerApproval', label: 'Sales manager (approved)' },
  { key: 'accountsManagerApproval', label: 'Accounts manager (approved)' },
]

// ── What the client's link may save ─────────────────────────────────────────

const SHORT_TEXT = 300
const LONG_TEXT = 2000

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
  for (const def of REPRESENTATIVE_FIELDS) {
    const v = cleanText(src[def.key], SHORT_TEXT)
    if (v !== undefined) out[def.key] = v
  }
  if (typeof src.declarationAccepted === 'boolean') out.declarationAccepted = src.declarationAccepted
  return out
}
