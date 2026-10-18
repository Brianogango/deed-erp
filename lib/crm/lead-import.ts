/**
 * Leads from a spreadsheet (expo lists, call lists). Column names vary from
 * sheet to sheet, so headers are matched loosely; each row is checked the
 * same way a lead typed in by hand is.
 */

import { phoneKey } from '@/lib/crm/phone-key'

export type ImportLead = { name: string; companyName: string; email: string; phone: string; notes: string }
export type ImportProblem = { row: number; problem: string }

const HEADERS: Record<keyof ImportLead, string[]> = {
  name: ['name', 'contact', 'contact name', 'contact person', 'full name', 'customer', 'customer name', 'client', 'person'],
  companyName: ['company', 'company name', 'organisation', 'organization', 'business', 'institution', 'school', 'firm', 'employer'],
  email: ['email', 'e mail', 'email address', 'e mail address', 'mail'],
  phone: ['phone', 'phone number', 'phone no', 'mobile', 'mobile number', 'mobile no', 'tel', 'tel no', 'telephone', 'contact number', 'contact no', 'cell', 'cell phone', 'whatsapp', 'whatsapp number'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks', 'requirement', 'requirements', 'interest', 'need', 'needs', 'description'],
}

const norm = (h: string) => h.toLowerCase().replace(/[_\-.:#()]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Which sheet column feeds each lead field (first match wins). */
export function mapColumns(headers: string[]): Partial<Record<keyof ImportLead, string>> {
  const out: Partial<Record<keyof ImportLead, string>> = {}
  for (const field of Object.keys(HEADERS) as (keyof ImportLead)[]) {
    const hit = headers.find(h => HEADERS[field].includes(norm(h)))
    if (hit) out[field] = hit
  }
  return out
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const cell = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** Spreadsheets turn 0712345678 into 712345678; put the 0 back. */
function phone(v: unknown): string {
  const raw = cell(v)
  return /^[17]\d{8}$/.test(raw) ? `0${raw}` : raw
}

export function parseLeadRows(rows: Array<Record<string, unknown>>): {
  leads: ImportLead[]
  problems: ImportProblem[]
  columns: Partial<Record<keyof ImportLead, string>>
} {
  const headers = rows.length ? Object.keys(rows[0]) : []
  const columns = mapColumns(headers)
  const leads: ImportLead[] = []
  const problems: ImportProblem[] = []
  const seen = new Set<string>()

  rows.forEach((r, i) => {
    const row = i + 2 // sheet row: 1 is the header
    const get = (f: keyof ImportLead) => (columns[f] ? r[columns[f]!] : '')
    const companyName = cell(get('companyName')).slice(0, 200)
    const name = (cell(get('name')) || companyName).slice(0, 200)
    const email = cell(get('email')).toLowerCase().slice(0, 150)
    const tel = phone(get('phone')).slice(0, 40)
    const notes = cell(get('notes')).slice(0, 2000)
    if (!name && !email && !tel) return // blank line
    if (!name) { problems.push({ row, problem: 'No name or company' }); return }
    if (!email && !tel) { problems.push({ row, problem: `${name}: no phone or email` }); return }
    if (email && !EMAIL.test(email)) { problems.push({ row, problem: `${name}: "${email}" is not an email address` }); return }
    const keys = [email && `e:${email}`, phoneKey(tel) && `p:${phoneKey(tel)}`].filter(Boolean) as string[]
    if (keys.some(k => seen.has(k))) { problems.push({ row, problem: `${name}: same phone or email as an earlier row` }); return }
    keys.forEach(k => seen.add(k))
    leads.push({ name, companyName, email, phone: tel, notes })
  })
  return { leads, problems, columns }
}
