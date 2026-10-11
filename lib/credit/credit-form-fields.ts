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
